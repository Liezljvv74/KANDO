import { and, eq } from 'drizzle-orm'
import { db, photos, users, type Tx } from '@kando/db'
import type { Me, MePatch } from '@kando/contract'
import { ownProvider, syncIdentity } from './providers/profile'
import { photoUrl } from './storage'
import { acceptLang, DEFAULT_LANG, isLang, type Lang } from '@kando/i18n'

export type SessionUser = { id: string; email: string; language: Lang; isProvider: boolean }
export type StaffRole = 'admin' | 'reviewer'
export type StaffUser = { id: string; email: string; staffRole: StaffRole }

/** The session email already belongs to a users row with a different id (a recreated Neon Auth account). */
export class EmailConflictError extends Error {
  constructor() {
    super('Email belongs to another account')
  }
}

/** Language from ?lang, else the first supported tag of Accept-Language, else the default. */
export function requestLang(request: Request): Lang {
  const q = new URL(request.url).searchParams.get('lang')
  if (isLang(q)) return q
  return acceptLang(request.headers.get('accept-language')) ?? DEFAULT_LANG
}

/** First contact creates the users row (owner connection); names and address are the person's own, set through the app. */
export async function ensureUser(session: { id: string; email: string }, request: Request): Promise<SessionUser> {
  try {
    await db
      .insert(users)
      .values({ id: session.id, email: session.email, language: requestLang(request) })
      .onConflictDoUpdate({ target: users.id, set: { email: session.email } }) // keeps a Neon Auth email change in sync
  } catch (error) {
    const cause = (error as { cause?: { code?: string; constraint?: string } }).cause
    if (cause?.code === '23505') throw new EmailConflictError()
    throw error
  }
  const row = (await db.select().from(users).where(eq(users.id, session.id)))[0]!
  return {
    id: row.id,
    email: row.email,
    language: isLang(row.language) ? row.language : DEFAULT_LANG,
    isProvider: row.isProvider,
  }
}

const toMe = (row: typeof users.$inferSelect, pictureKey: string | null): Me => ({
  id: row.id,
  email: row.email,
  firstName: row.firstName,
  lastName: row.lastName,
  language: isLang(row.language) ? row.language : DEFAULT_LANG,
  isProvider: row.isProvider,
  photoUrl: pictureKey ? photoUrl(pictureKey) : null,
  address: row.addressStreet
    ? { street: row.addressStreet, postcode: row.addressPostcode ?? '', city: row.addressCity ?? '', country: row.addressCountry ?? 'DE' }
    : null,
  notifications: [], // filled when notifications are created
})

/** The signed-in person: names, language, picture (their profile photo) and private address. */
export async function getMe(tx: Tx, userId: string): Promise<Me> {
  const row = (await tx.select().from(users).where(eq(users.id, userId)))[0]!
  const pic = (await tx.select({ key: photos.key }).from(photos).where(and(eq(photos.ownerId, userId), eq(photos.kind, 'profile'))))[0]
  return toMe(row, pic?.key ?? null)
}

/** Saves what changed; address null clears it. A new name reaches the public name of an existing provider profile. */
export async function updateMe(tx: Tx, userId: string, patch: MePatch): Promise<Me> {
  const a = patch.address
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
        addressCountry: a ? a.country || 'DE' : null,
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
