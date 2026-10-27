import { eq } from 'drizzle-orm'
import { db, users } from '@kando/db'
import { DEFAULT_LANG, isLang, type Lang } from '@kando/i18n'

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
  for (const part of (request.headers.get('accept-language') ?? '').split(',')) {
    const tag = part.split(';')[0]!.trim().toLowerCase().split('-')[0]!
    if (isLang(tag)) return tag
  }
  return DEFAULT_LANG
}

/**
 * First contact creates the users row (owner connection) with the account name from the session, so the public name
 * does not depend on the app's own name save; later calls return the stored row and never overwrite the name.
 */
export async function ensureUser(session: { id: string; email: string; name?: string }, request: Request): Promise<SessionUser> {
  try {
    await db
      .insert(users)
      .values({ id: session.id, email: session.email, name: session.name?.trim().slice(0, 100) || null, language: requestLang(request) })
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

/** Administrator passes everything; Reviewer passes 'reviewer' and 'any'. */
export function staffAllows(staffRole: string | null, role: StaffRole | 'any'): boolean {
  if (staffRole === 'admin') return true
  return staffRole === 'reviewer' && (role === 'reviewer' || role === 'any')
}
