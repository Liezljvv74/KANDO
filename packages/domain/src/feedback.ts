import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { FeedbackInput } from '@kando/contract'
import type { Lang } from '@kando/i18n'
import { escapeHtml, transport, type Mail } from './email'
import type { Exec } from './providers/eligibility'
import type { SessionUser } from './users'

/** Feedback goes to this one address, set here, never taken from a request. */
export const FEEDBACK_TO = 'info@skillweb.space'
export const FEEDBACK_SUBJECT = 'Feedback from the app'
const FROM = 'SkillWeb <noreply@skillweb.space>'
/** Messages allowed per window: signed out per IP address, signed in per account. */
export const FEEDBACK_LIMITS = {
  signedOut: { perHour: 1, perDay: 1 },
  signedIn: { perHour: 5, perDay: 10 },
}
/** Attempt rows older than this are deleted by the daily clean-up (retention.ts). */
export const FEEDBACK_ATTEMPT_KEEP_DAYS = 2
const IP_SALT = 'skillweb-feedback-ip-v1'

export class FeedbackLimited extends Error {}
export class FeedbackSendFailed extends Error {}

/** Header-safe: no CR, LF or other control characters. */
const oneLine = (s: string) => s.replace(/\p{Cc}+/gu, ' ').trim()

/** The mail to the owner. replyTo is the sender's address; only the user id and app language are added for a signed-in person. */
export function buildFeedbackMail(input: FeedbackInput, who: { id: string; language: Lang } | null): Mail {
  const email = oneLine(input.email)
  const lines = [`From: ${email}`, ...(who ? [`User id: ${oneLine(who.id)}`, `App language: ${who.language}`] : ['Signed out']), '', input.message]
  const text = lines.join('\n')
  const html = `<p>${escapeHtml(text).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>`
  return { to: FEEDBACK_TO, from: FROM, replyTo: email, subject: FEEDBACK_SUBJECT, text, html }
}

/** Callers who are signed out are counted by a salted hash of the address Vercel sets (never x-forwarded-for, a caller can set that), never the raw address. */
export function ipHashOf(headers: Pick<Headers, 'get'>): string {
  const ip = (headers.get('x-vercel-forwarded-for') || headers.get('x-real-ip'))?.split(',')[0]?.trim() || 'unknown'
  return createHash('sha256').update(`${process.env.NEON_AUTH_COOKIE_SECRET ?? ''}${IP_SALT}${ip}`).digest('hex')
}

/**
 * Counts the attempt first (so parallel calls cannot slip past the limit), then emails; a mail that fails does not count.
 * Throws FeedbackLimited or FeedbackSendFailed. Needs the owner connection (`db`, never a request transaction). The message is never stored or logged.
 */
export async function sendFeedback(
  exec: Exec,
  input: FeedbackInput,
  user: Pick<SessionUser, 'id' | 'language'> | null,
  ipHash: string,
  send: (mail: Mail) => Promise<boolean> = (m) => transport(m, 'feedback'),
): Promise<void> {
  const limit = user ? FEEDBACK_LIMITS.signedIn : FEEDBACK_LIMITS.signedOut
  const who = user ? sql`user_id = ${user.id}` : sql`user_id IS NULL AND ip_hash = ${ipHash}`
  const inserted = await exec.execute<{ id: string }>(sql`INSERT INTO feedback_attempts (user_id, ip_hash) VALUES (${user?.id ?? null}, ${ipHash}) RETURNING id`)
  const id = inserted.rows[0]!.id
  const { rows } = await exec.execute<{ h: number; d: number }>(
    sql`SELECT count(*) FILTER (WHERE created_at > now() - interval '1 hour')::int AS h, count(*)::int AS d FROM feedback_attempts WHERE ${who} AND created_at > now() - interval '24 hours'`,
  )
  const undo = () => exec.execute(sql`DELETE FROM feedback_attempts WHERE id = ${id}`)
  if (rows[0]!.h > limit.perHour || rows[0]!.d > limit.perDay) {
    await undo()
    throw new FeedbackLimited('Rate limit reached')
  }
  if (!(await send(buildFeedbackMail(input, user)))) {
    await undo()
    throw new FeedbackSendFailed('Mail service failed')
  }
}
