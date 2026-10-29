import { asc, eq, inArray, lte, sql } from 'drizzle-orm'
import { availabilityWatches, blocks, bookings, contactAttempts, db, messages, staffFlags, threads, documents, notifications, pendingObjectDeletes, photos, retainedRecords, privateFiles, providerReferences, providers, quotes, requests, services, users, type Tx } from '@kando/db'
import { DEFAULT_LANG, isLang, LOCALE } from '@kando/i18n'
import type { AfterCommit } from './app-request'
import { sendEmail } from './email'
import { fail } from './providers/http'
import { documentsBucket, mediaBucket, storage } from './storage'
import { activeAdmins, lockAdmins } from './users'

/** Every table with a foreign key to users or providers, deleted below in this order; a test fails when the schema grows another. */
export const ACCOUNT_TABLES = ['availability_watches', 'contact_attempts', 'staff_flags', 'messages', 'threads', 'blocks', 'bookings', 'quotes', 'requests', 'notifications', 'documents', 'private_files', 'photos', 'provider_references', 'services', 'providers']

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

/** Booking statuses that hold the customer's money: the account cannot be deleted until they are settled (plan 2d adds its own). */
export const MONEY_OPEN_STATUSES = ['confirmed'] as const

/**
 * How many months the verification documents and basic trader details of a deleted provider are kept (a legal duty under
 * review). DELETE_RETENTION_MONTHS overrides it; 0 switches the retention off (everything is deleted at once). Unset or
 * not a whole number: 6.
 */
export function retentionMonths(): number {
  const raw = process.env.DELETE_RETENTION_MONTHS
  return raw !== undefined && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : 6
}

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
 * LAST_ADMIN for the only Administrator; 409 OPEN_BOOKINGS while they are customer or provider on a booking holding money
 * (MONEY_OPEN_STATUSES). The object keys are written to pending_object_deletes in the same transaction; after the commit the objects are deleted and their rows cleared, and the daily job retries what is left, so erasure of
 * the files does not hang on one attempt. Then the confirmation email goes to the address as it was before.
 * The shared translations cache and the rate-limit rows keyed by an ip hash are not the person's data and stay.
 */
export async function deleteAccount(userId: string, confirmEmail: string, afterCommit: AfterCommit): Promise<void> {
  const months = retentionMonths()
  const { email, language, tombstones, keepUntil } = await db.transaction(async (tx) => {
    // Lock order everywhere: the Administrator set (by id) first, then the person's own row.
    const admins = await lockAdmins(tx)
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('update')
    if (!user) return fail(404, { error: 'Not found' })
    if (confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()) fail(400, { error: 'EMAIL_MISMATCH' })
    if (user.staffRole === 'admin' && !activeAdmins(admins).some((a) => a.id !== userId)) fail(409, { error: 'LAST_ADMIN' })
    const own = tx.select({ id: providers.id }).from(providers).where(eq(providers.ownerId, userId))
    // Paid money is still open (paid and not released, whatever the status, or a money-open status): refuse. The person's bookings (either side) are locked before the check, so
    // the payment code cannot confirm one in between: its update waits for this transaction and then finds the row gone.
    // Lock order: Administrator set, the person, their bookings (by id); settlement and payment lock only a booking row
    // (payment after the provider's slot lock, which this never takes), so there is no cycle. Ledger rows are never touched.
    const theirs = await tx
      .select({ status: bookings.status, paidAt: bookings.paidAt, releasedAt: bookings.releasedAt })
      .from(bookings)
      .where(sql`${bookings.customerId} = ${userId} OR ${bookings.providerId} IN ${own}`)
      .orderBy(asc(bookings.id))
      .for('update')
    if (theirs.some((b) => (b.paidAt && !b.releasedAt) || (MONEY_OPEN_STATUSES as readonly string[]).includes(b.status))) fail(409, { error: 'OPEN_BOOKINGS' })
    // Every object key first: after the rows are gone nothing says where the files are.
    const media = await tx.select({ key: photos.key }).from(photos).where(eq(photos.ownerId, userId))
    const files = await tx.select({ key: privateFiles.key }).from(privateFiles).where(eq(privateFiles.ownerId, userId))
    const docs = await tx.select({ key: documents.key }).from(documents).where(eq(documents.ownerId, userId))
    // A provider or a person with submitted documents is a trader: basic details and the document metadata are kept for the
    // retention period, and the document objects stay in storage until then (everything else is deleted as before).
    const [provider] = await tx.select().from(providers).where(eq(providers.ownerId, userId))
    const docRows = await tx.select().from(documents).where(eq(documents.ownerId, userId))
    let keepUntil: Date | null = null
    if (months > 0 && (provider || docRows.length)) {
      const [record] = await tx
        .insert(retainedRecords)
        .values({
          formerUserId: userId,
          details: {
            name: [user.firstName, user.lastName].filter(Boolean).join(' ') || null,
            businessName: provider?.businessName ?? null,
            email: user.email,
            address: { street: user.addressStreet, postcode: user.addressPostcode, city: user.addressCity, country: user.addressCountry },
            legalStatus: provider?.legalStatus ?? null,
            vatId: provider?.vatId ?? null,
            providerType: provider?.type ?? null,
            impressum: provider?.impressum ?? null,
            deletedAt: new Date().toISOString(),
          },
          documents: docRows.map((d) => ({ bucket: documentsBucket(), key: d.key, requirement: d.requirement, status: d.status, staffNote: d.note, reviewedAt: d.reviewedAt?.toISOString() ?? null, uploadedAt: d.createdAt.toISOString() })),
          deleteAfter: sql`now() + make_interval(months => ${months})`,
        })
        .returning({ deleteAfter: retainedRecords.deleteAfter })
      keepUntil = record!.deleteAfter
    }
    await tx.update(documents).set({ reviewedBy: null }).where(eq(documents.reviewedBy, userId)) // a staff reviewer: their id is personal data on others' documents
    await tx.delete(notifications).where(eq(notifications.userId, userId))
    await tx.delete(documents).where(eq(documents.ownerId, userId))
    await tx.delete(privateFiles).where(eq(privateFiles.ownerId, userId))
    await tx.delete(photos).where(eq(photos.ownerId, userId))
    // Requests, quotes and bookings of either side (this person as customer, or as the provider), before services and providers.
    // Chat first: threads point at requests and bookings, and everything points at the person.
    const ownThreads = tx.select({ id: threads.id }).from(threads).where(sql`${threads.customerId} = ${userId} OR ${threads.providerId} IN ${own}`)
    await tx.delete(contactAttempts).where(sql`${contactAttempts.userId} = ${userId} OR ${contactAttempts.threadId} IN ${ownThreads}`)
    await tx.delete(staffFlags).where(eq(staffFlags.userId, userId))
    const chatPhotos = await tx.select({ key: messages.photoKey }).from(messages).where(sql`${messages.photoKey} IS NOT NULL AND (${messages.senderId} = ${userId} OR ${messages.threadId} IN ${ownThreads})`)
    await tx.delete(messages).where(sql`${messages.senderId} = ${userId} OR ${messages.threadId} IN ${ownThreads}`)
    await tx.delete(threads).where(sql`${threads.customerId} = ${userId} OR ${threads.providerId} IN ${own}`)
    await tx.delete(blocks).where(sql`${blocks.blockerId} = ${userId} OR ${blocks.blockedId} = ${userId}`)
    await tx.delete(availabilityWatches).where(sql`${availabilityWatches.customerId} = ${userId} OR ${availabilityWatches.providerId} IN ${own}`)
    await tx.delete(bookings).where(sql`${bookings.customerId} = ${userId} OR ${bookings.providerId} IN ${own}`)
    await tx.delete(quotes).where(sql`${quotes.providerId} IN ${own}`)
    await tx.delete(requests).where(sql`${requests.customerId} = ${userId} OR ${requests.providerId} IN ${own}`)
    await tx.delete(providerReferences).where(sql`${providerReferences.providerId} IN ${own}`)
    await tx.delete(services).where(sql`${services.providerId} IN ${own}`)
    await tx.delete(providers).where(eq(providers.ownerId, userId))
    await tx.execute(sql`DELETE FROM translation_requests WHERE client_key = ${`user:${userId}`}`)
    await tx.delete(users).where(eq(users.id, userId))
    await deleteAuthRecords(tx, userId, user.email)
    const owed = [
      ...media.map((m) => ({ bucket: mediaBucket(), key: m.key })),
      // The submitted documents' objects stay while they are retained.
      ...[...files, ...(keepUntil ? [] : docs)].map((f) => ({ bucket: documentsBucket(), key: f.key })),
      // Chat photos of the person's threads (both sides' photos: the thread goes).
      ...chatPhotos.map((m) => ({ bucket: documentsBucket(), key: m.key! })),
    ]
    const tombstones = owed.length ? (await tx.insert(pendingObjectDeletes).values(owed).returning({ id: pendingObjectDeletes.id })).map((r) => r.id) : []
    return { email: user.email, language: user.language, tombstones, keepUntil }
  })
  afterCommit(async () => void (await flushPendingObjects(tombstones)))
  const lang = isLang(language) ? language : DEFAULT_LANG
  afterCommit(() =>
    sendEmail({
      to: email,
      lang,
      template: keepUntil ? 'account-deleted-retained' : 'account-deleted',
      params: keepUntil ? { date: keepUntil.toLocaleDateString(LOCALE[lang], { timeZone: 'Europe/Berlin' }), months: String(months) } : {},
    }),
  )
}

/**
 * Removes the objects of retained records whose time is up, then the records (a bounded batch). An object that cannot be
 * deleted is handed to pending_object_deletes, so the record can go and the retry job takes over. Returns how many records went.
 */
export async function purgeExpiredRetained(limit = 50): Promise<number> {
  const due = await db.select().from(retainedRecords).where(lte(retainedRecords.deleteAfter, new Date())).orderBy(asc(retainedRecords.deleteAfter)).limit(limit)
  let owed = 0
  for (const record of due) {
    const objects = record.documents as { bucket: string; key: string }[]
    const results = await Promise.allSettled(objects.map((o) => storage().delete(o.bucket, o.key)))
    const failed = objects.filter((_, i) => results[i]!.status === 'rejected')
    owed += failed.length
    await db.transaction(async (tx) => {
      if (failed.length) await tx.insert(pendingObjectDeletes).values(failed.map((o) => ({ bucket: o.bucket, key: o.key })))
      await tx.delete(retainedRecords).where(eq(retainedRecords.id, record.id))
    })
  }
  if (owed) console.error(`[account] ${owed} retained objects could not be removed now, left for the retry`)
  return due.length
}
