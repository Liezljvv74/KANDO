import { eq, sql } from 'drizzle-orm'
import { db, documents, notifications, photos, privateFiles, providerReferences, providers, services, users, type Tx } from '@kando/db'
import { DEFAULT_LANG, isLang } from '@kando/i18n'
import type { AfterCommit } from './app-request'
import { sendEmail } from './email'
import { fail } from './providers/http'
import { documentsBucket, mediaBucket, storage } from './storage'

/** Every table with a foreign key to users or providers, deleted below in this order; a test fails when the schema grows another. */
export const ACCOUNT_TABLES = ['notifications', 'documents', 'private_files', 'photos', 'provider_references', 'services', 'providers']

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`

/**
 * Removes the person's Neon Auth records on the same transaction: the user, plus every neon_auth table that points at it
 * (account, session, member, ... found by column name, so a plain DELETE of the user row need not cascade) and the pending
 * verification codes (keyed by email). Where the schema does not exist (the test database) nothing happens.
 */
async function deleteAuthRecords(tx: Tx, id: string, email: string) {
  if (!(await tx.execute(sql`SELECT to_regclass('neon_auth."user"') AS t`)).rows[0]!.t) return
  const refs = await tx.execute<{ table_name: string; column_name: string }>(
    sql`SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'neon_auth' AND table_name <> 'user' AND column_name IN ('userId', 'user_id', 'inviterId')`,
  )
  for (const r of refs.rows) await tx.execute(sql.raw(`DELETE FROM neon_auth.${quote(r.table_name)} WHERE ${quote(r.column_name)} = '${id.replaceAll("'", "''")}'`))
  if ((await tx.execute(sql`SELECT to_regclass('neon_auth.verification') AS t`)).rows[0]!.t) {
    await tx.execute(sql`DELETE FROM neon_auth.verification WHERE lower(identifier) = lower(${email})`)
  }
  await tx.execute(sql`DELETE FROM neon_auth."user" WHERE id = ${id}`)
}

/**
 * Deletes the person and everything of theirs for good (GDPR erasure), in one transaction on the owner connection (app_user
 * may not delete from several of these tables). 400 EMAIL_MISMATCH unless `confirmEmail` is their stored email; 409
 * LAST_ADMIN for the only Administrator. Objects in storage are removed once the transaction has committed (a failure is
 * logged, never turns the answer into an error), then the confirmation email goes to the address as it was before.
 * The shared translations cache and the rate-limit rows keyed by an ip hash are not the person's data and stay.
 */
export async function deleteAccount(userId: string, confirmEmail: string, afterCommit: AfterCommit): Promise<void> {
  const { email, language, mediaKeys, documentKeys } = await db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('update')
    if (!user) return fail(404, { error: 'Not found' })
    if (confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()) fail(400, { error: 'EMAIL_MISMATCH' })
    if (user.staffRole === 'admin') {
      // Same lock as demoting an Administrator: two admins deleting themselves at once cannot both pass.
      const admins = await tx.execute<{ id: string }>(sql`SELECT id FROM users WHERE staff_role = 'admin' AND (suspended_until IS NULL OR suspended_until <= now()) FOR UPDATE`)
      if (!admins.rows.some((a) => a.id !== userId)) fail(409, { error: 'LAST_ADMIN' })
    }
    // Every object key first: after the rows are gone nothing says where the files are.
    const media = await tx.select({ key: photos.key }).from(photos).where(eq(photos.ownerId, userId))
    const files = await tx.select({ key: privateFiles.key }).from(privateFiles).where(eq(privateFiles.ownerId, userId))
    const docs = await tx.select({ key: documents.key }).from(documents).where(eq(documents.ownerId, userId))
    await tx.delete(notifications).where(eq(notifications.userId, userId))
    await tx.delete(documents).where(eq(documents.ownerId, userId))
    await tx.delete(privateFiles).where(eq(privateFiles.ownerId, userId))
    await tx.delete(photos).where(eq(photos.ownerId, userId))
    const own = tx.select({ id: providers.id }).from(providers).where(eq(providers.ownerId, userId))
    await tx.delete(providerReferences).where(sql`${providerReferences.providerId} IN ${own}`)
    await tx.delete(services).where(sql`${services.providerId} IN ${own}`)
    await tx.delete(providers).where(eq(providers.ownerId, userId))
    await tx.execute(sql`DELETE FROM translation_requests WHERE client_key = ${`user:${userId}`}`)
    await tx.delete(users).where(eq(users.id, userId))
    await deleteAuthRecords(tx, userId, user.email)
    return { email: user.email, language: user.language, mediaKeys: media.map((m) => m.key), documentKeys: [...files, ...docs].map((f) => f.key) }
  })
  afterCommit(async () => {
    // Not removeObject: its log line names the key, which carries the person's id. Here only the count and the error name.
    const gone = await Promise.allSettled([
      ...mediaKeys.map((k) => storage().delete(mediaBucket(), k)),
      ...documentKeys.map((k) => storage().delete(documentsBucket(), k)),
    ])
    const failed = gone.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    if (failed.length) console.error(`[account] ${failed.length} of ${gone.length} objects could not be removed`, failed[0]!.reason instanceof Error ? failed[0]!.reason.name : 'unknown')
  })
  afterCommit(() => sendEmail({ to: email, lang: isLang(language) ? language : DEFAULT_LANG, template: 'account-deleted', params: {} }))
}
