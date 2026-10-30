import { and, count, eq, gte } from 'drizzle-orm'
import { contactAttempts, db, staffFlags } from '@kando/db'
import { describeError } from '../log-error'
import { fail } from '../providers/http'
import type { Exec } from '../providers/eligibility'
import { checkContactDetails } from './contact-check'
import { CONTACT_ATTEMPTS_LIMIT, CONTACT_ATTEMPTS_WINDOW_HOURS } from './rules'

/** The `staff_flags.kind` values; later plans widen this with the table's check. */
export type StaffFlagKind = 'contact-attempts' | 'message-reported' | 'chargeback' | 'refund-failed' | 'payment-unprocessed'

/** One open flag per kind, ref and user: a second one is ignored. Staff-only table, so pass the owner connection. */
export async function flagForStaff(exec: Exec, flag: { kind: StaffFlagKind; refId: string; userId?: string; note?: string }): Promise<void> {
  await exec.insert(staffFlags).values({ kind: flag.kind, refId: flag.refId, userId: flag.userId ?? null, note: flag.note ?? null }).onConflictDoNothing()
}

/** Records the blocked attempt and flags a repeat offender; on the owner connection, so it survives the rollback of the request. */
async function recordAttempt(userId: string, text: string, hit: string, threadId?: string): Promise<void> {
  try {
    await db.insert(contactAttempts).values({ userId, threadId: threadId ?? null, hit, text })
    const since = new Date(Date.now() - CONTACT_ATTEMPTS_WINDOW_HOURS * 3_600_000)
    const n = (await db.select({ n: count() }).from(contactAttempts).where(and(eq(contactAttempts.userId, userId), gte(contactAttempts.createdAt, since))))[0]!.n
    if (n >= CONTACT_ATTEMPTS_LIMIT) await flagForStaff(db, { kind: 'contact-attempts', refId: userId, userId, note: `${n} blocked attempts` })
  } catch (e) {
    console.error(`[chat] could not record a contact attempt ${describeError(e)}`) // the 422 still goes out
  }
}

/** 422 CONTACT_DETAILS when the text holds a phone number, email or link. The text is kept for staff only, never shown to the other party. */
export async function assertNoContactDetails(userId: string, text: string, threadId?: string): Promise<void> {
  const hit = await checkContactDetails(text)
  if (!hit) return
  await recordAttempt(userId, text, hit, threadId)
  fail(422, { error: 'CONTACT_DETAILS' })
}
