import { asc, eq, inArray, sql } from 'drizzle-orm'
import { db, documents, notifications, pendingObjectDeletes, photos, privateFiles, providerReferences, providers, services, users, type Tx } from '@kando/db'
import { DEFAULT_LANG, isLang } from '@kando/i18n'
import type { AfterCommit } from './app-request'
import { sendEmail } from './email'
import { fail } from './providers/http'
import { documentsBucket, mediaBucket, storage } from './storage'
import { activeAdmins, lockAdmins } from './users'

/** Every table with a foreign key to users or providers, deleted below in this order; a test fails when the schema grows another. */
export const ACCOUNT_TABLES = ['notifications', 'documents', 'private_files', 'photos', 'provider_references', 'services', 'providers']

/** Better Auth's email-OTP plugin keys a pending code as `<type>-otp-<email>`; these are the types it uses. */
export const OTP_TYPES = ['email-verification', 'forget-password', 'sign-in', 'change-email']

/**
 * Removes the person's Neon Auth records on the same transaction: every neon_auth table with a foreign key to the user
 * (found in the catalogue, so nothing depends on a cascade), the pending verification codes (the bare email and
 * `<type>-otp-<email>`, exact matches only) and then the user. Where the schema does not exist (the test database) nothing happens.
 */
async function deleteAuthRecords(tx: Tx, id: string, email: string) {
  if (!(await tx.execute(sql`SELECT to_regclass('neon_auth."user"') AS t`)).rows[0]!.t) return
  const refs = await tx.execute<{ tbl: string; col: string }>(
    sql`SELECT cl.relname AS tbl, a.attname AS col
        FROM pg_constraint c
        JOIN pg_class cl ON cl.oid = c.conrelid
        JOIN pg_namespace ns ON ns.oid = cl.relnamespace AND ns.nspname = 'neon_auth'
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        WHERE c.contype = 'f' AND array_length(c.conkey, 1) = 1 AND c.confrelid = to_regclass('neon_auth."user"')`,
  )
  for (const r of refs.rows) await tx.execute(sql`DELETE FROM ${sql.identifier('neon_auth')}.${sql.identifier(r.tbl)} WHERE ${sql.identifier(r.col)} = ${id}`)
  if ((await tx.execute(sql`SELECT to_regclass('neon_auth.verification') AS t`)).rows[0]!.t) {
    const identifiers = [email, ...OTP_TYPES.map((type) => `${type}-otp-${email}`)].map((v) => v.toLowerCase())
    await tx.execute(sql`DELETE FROM neon_auth.verification WHERE lower(identifier) IN (${sql.join(identifiers.map((v) => sql`${v}`), sql`, `)})`)
  }
  await tx.execute(sql`DELETE FROM neon_auth."user" WHERE id = ${id}`)
}

const BATCH = 200

/**
 * Deletes the objects named by pending_object_deletes rows (the given ids, else the oldest batch) and clears the rows of
 * those that are gone. A failure leaves its row for the next try and logs only the count and the error name (keys carry
 * the person's id). Returns how many of this batch are still waiting.
 */
export async function flushPendingObjects(ids?: string[]): Promise<number> {
  const rows = ids
    ? ids.length
      ? await db.select().from(pendingObjectDeletes).where(inArray(pendingObjectDeletes.id, ids))
      : []
    : await db.select().from(pendingObjectDeletes).orderBy(asc(pendingObjectDeletes.createdAt)).limit(BATCH)
  const results = await Promise.allSettled(rows.map((r) => storage().delete(r.bucket, r.key)))
  const gone = rows.filter((_, i) => results[i]!.status === 'fulfilled').map((r) => r.id)
  if (gone.length) await db.delete(pendingObjectDeletes).where(inArray(pendingObjectDeletes.id, gone))
  const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (failed.length) console.error(`[account] ${failed.length} of ${rows.length} objects could not be removed`, failed[0]!.reason instanceof Error ? failed[0]!.reason.name : 'unknown')
  return failed.length
}

/**
 * Deletes the person and everything of theirs for good (GDPR erasure), in one transaction on the owner connection (app_user
 * may not delete from several of these tables). 400 EMAIL_MISMATCH unless `confirmEmail` is their stored email; 409
 * LAST_ADMIN for the only Administrator. The object keys are written to pending_object_deletes in the same transaction;
 * after the commit the objects are deleted and their rows cleared, and the daily job retries what is left, so erasure of
 * the files does not hang on one attempt. Then the confirmation email goes to the address as it was before.
 * The shared translations cache and the rate-limit rows keyed by an ip hash are not the person's data and stay.
 */
export async function deleteAccount(userId: string, confirmEmail: string, afterCommit: AfterCommit): Promise<void> {
  const { email, language, tombstones } = await db.transaction(async (tx) => {
    // Lock order everywhere: the Administrator set (by id) first, then the person's own row.
    const admins = await lockAdmins(tx)
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('update')
    if (!user) return fail(404, { error: 'Not found' })
    if (confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()) fail(400, { error: 'EMAIL_MISMATCH' })
    if (user.staffRole === 'admin' && !activeAdmins(admins).some((a) => a.id !== userId)) fail(409, { error: 'LAST_ADMIN' })
    // Every object key first: after the rows are gone nothing says where the files are.
    const media = await tx.select({ key: photos.key }).from(photos).where(eq(photos.ownerId, userId))
    const files = await tx.select({ key: privateFiles.key }).from(privateFiles).where(eq(privateFiles.ownerId, userId))
    const docs = await tx.select({ key: documents.key }).from(documents).where(eq(documents.ownerId, userId))
    await tx.update(documents).set({ reviewedBy: null }).where(eq(documents.reviewedBy, userId)) // a staff reviewer: their id is personal data on others' documents
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
    const owed = [
      ...media.map((m) => ({ bucket: mediaBucket(), key: m.key })),
      ...[...files, ...docs].map((f) => ({ bucket: documentsBucket(), key: f.key })),
    ]
    const tombstones = owed.length ? (await tx.insert(pendingObjectDeletes).values(owed).returning({ id: pendingObjectDeletes.id })).map((r) => r.id) : []
    return { email: user.email, language: user.language, tombstones }
  })
  afterCommit(async () => void (await flushPendingObjects(tombstones)))
  afterCommit(() => sendEmail({ to: email, lang: isLang(language) ? language : DEFAULT_LANG, template: 'account-deleted', params: {} }))
}
