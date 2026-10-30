import { assertNoContactDetailsIn } from './chat/flags'
import { and, eq, sql } from 'drizzle-orm'
import { db, isPostcode, photos, users, type Tx } from '@kando/db'
import type { Me, MePatch } from '@kando/contract'
import { fail } from './providers/http'
import { ownProvider, syncIdentity } from './providers/profile'
import { listNotifications } from './notifications-store'
import { photoUrl } from './storage'
import { acceptLang, DEFAULT_LANG, isLang, type Lang } from '@kando/i18n'

export type SessionUser = { id: string; email: string; language: Lang; isProvider: boolean; suspendedUntil: Date | null }
export type StaffRole = 'admin' | 'reviewer'
export type StaffUser = { id: string; email: string; staffRole: StaffRole }

/** The session email already belongs to a users row with a different id (a recreated Neon Auth account). */
export class EmailConflictError extends Error {
  constructor() {
    super('Email belongs to another account')
  }
}

/** The session's account no longer exists in Neon Auth (deleted); a cached session cookie may still look valid for minutes. */
export class SessionGoneError extends Error {
  constructor() {
    super('Account no longer exists')
  }
}

type AdminRow = { id: string; suspended_until: Date | null }
/**
 * The first lock of any operation that may change the Administrator set, taken before the person's own row: one advisory lock
 * serialises those operations (row locks alone, even in id order, deadlocked two concurrent ones in a test), then every
 * Administrator row is locked in id order.
 */
export async function lockAdmins(tx: Tx): Promise<AdminRow[]> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('kando.administrator-set'))`)
  return (await tx.execute<AdminRow>(sql`SELECT id, suspended_until FROM users WHERE staff_role = 'admin' ORDER BY id FOR UPDATE`)).rows
}
/** The Administrators who are not suspended (a past suspended_until counts as none). */
export const activeAdmins = (rows: AdminRow[]) => rows.filter((a) => !a.suspended_until || a.suspended_until <= new Date())

/** Language from ?lang, else the first supported tag of Accept-Language, else the default. */
export function requestLang(request: Request): Lang {
  const q = new URL(request.url).searchParams.get('lang')
  if (isLang(q)) return q
  return acceptLang(request.headers.get('accept-language')) ?? DEFAULT_LANG
}

// The Neon Auth schema neither appears nor vanishes while the process runs: checked once.
let neonAuthPresent: boolean | undefined

/** First contact creates the users row (owner connection); names and address are the person's own, set through the app. Two reads; a write only for a new person or a changed email. */
export async function ensureUser(session: { id: string; email: string }, request: Request): Promise<SessionUser> {
  // Where Neon Auth lives in this database, an id it no longer knows (a deleted account) gets no users row: 401 instead.
  neonAuthPresent ??= !!(await db.execute(sql`SELECT to_regclass('neon_auth."user"') AS t`)).rows[0]!.t
  if (neonAuthPresent && !(await db.execute(sql`SELECT 1 FROM neon_auth."user" WHERE id = ${session.id}`)).rows.length) throw new SessionGoneError()
  let row = (await db.select().from(users).where(eq(users.id, session.id)))[0]
  if (!row || row.email !== session.email) {
    try {
      row = (
        row
          ? await db.update(users).set({ email: session.email }).where(eq(users.id, session.id)).returning()
          : await db
              .insert(users)
              .values({ id: session.id, email: session.email, language: requestLang(request) })
              .onConflictDoUpdate({ target: users.id, set: { email: session.email } }) // a concurrent first contact
              .returning()
      )[0]!
    } catch (error) {
      const cause = (error as { cause?: { code?: string; constraint?: string } }).cause
      if (cause?.code === '23505') throw new EmailConflictError()
      throw error
    }
  }
  return {
    id: row.id,
    email: row.email,
    language: isLang(row.language) ? row.language : DEFAULT_LANG,
    isProvider: row.isProvider,
    suspendedUntil: row.suspendedUntil,
  }
}

/** The stored address, whenever a postcode exists (street and city may be null). */
export const addressOf = (row: typeof users.$inferSelect): Me['address'] =>
  row.addressPostcode && row.addressCountry
    ? { street: row.addressStreet, postcode: row.addressPostcode, city: row.addressCity, country: row.addressCountry }
    : null

const toMe = (row: typeof users.$inferSelect, pictureKey: string | null, notifications: Me['notifications']): Me => ({
  id: row.id,
  email: row.email,
  firstName: row.firstName,
  lastName: row.lastName,
  language: isLang(row.language) ? row.language : DEFAULT_LANG,
  isProvider: row.isProvider,
  photoUrl: pictureKey ? photoUrl(pictureKey) : null,
  address: addressOf(row),
  notifications,
})

/** The signed-in person: names, language, picture (their profile photo) and private address. */
export async function getMe(tx: Tx, userId: string): Promise<Me> {
  const row = (await tx.select().from(users).where(eq(users.id, userId)))[0]!
  const pic = (await tx.select({ key: photos.key }).from(photos).where(and(eq(photos.ownerId, userId), eq(photos.kind, 'profile'))))[0]
  return toMe(row, pic?.key ?? null, await listNotifications(tx, userId))
}

/** Saves what changed; address null clears it. A new name reaches the public name of an existing provider profile. */
export async function updateMe(tx: Tx, userId: string, patch: MePatch): Promise<Me> {
  await assertNoContactDetailsIn(userId, [patch.firstName, patch.lastName])
  const a = patch.address
  if (a && !(await isPostcode(a.country, a.postcode, tx))) fail(400, { error: 'Invalid postcode' }) // the format only: a real but unlisted postcode is fine
  await tx
    .update(users)
    .set({
      ...(patch.firstName !== undefined && { firstName: patch.firstName }),
      ...(patch.lastName !== undefined && { lastName: patch.lastName }),
      ...(patch.language !== undefined && { language: patch.language }),
      ...(a !== undefined && {
        addressStreet: a?.street ?? null,
        addressPostcode: a?.postcode ?? null,
        addressCity: a?.city ?? null,
        addressCountry: a?.country ?? null,
      }),
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))
  if (patch.firstName !== undefined || patch.lastName !== undefined) {
    const provider = await ownProvider(tx, userId)
    if (provider) await syncIdentity(tx, userId, provider)
  }
  return getMe(tx, userId)
}

/** Administrator passes everything; Reviewer passes 'reviewer' and 'any'. */
export function staffAllows(staffRole: string | null, role: StaffRole | 'any'): boolean {
  if (staffRole === 'admin') return true
  return staffRole === 'reviewer' && (role === 'reviewer' || role === 'any')
}
