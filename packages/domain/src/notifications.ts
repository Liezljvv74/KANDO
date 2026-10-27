import { eq } from 'drizzle-orm'
import { db, users } from '@kando/db'
import { DEFAULT_LANG, isLang, LOCALE } from '@kando/i18n'
import { sendEmail } from './email'

/** What a staff decision on a document tells the owner. */
export type DocumentDecision = { id: string; requirement: string; status: 'approved' | 'rejected'; note: string | null }

export async function notifyDocumentDecision(userId: string, document: DocumentDecision): Promise<void> {
  try {
    const [user] = await db.select({ email: users.email, language: users.language }).from(users).where(eq(users.id, userId))
    if (!user) return
    await sendEmail({
      to: user.email,
      lang: isLang(user.language) ? user.language : DEFAULT_LANG,
      template: document.status === 'approved' ? 'document-approved' : 'document-rejected',
      params: { requirement: document.requirement, note: document.note },
    })
  } catch (e) {
    // After commit: a failure here must never reach the request.
    console.error('[notify] document decision email failed', e instanceof Error ? e.message : 'unknown')
  }
}

/** Tells the user their profile was suspended until `until` (with the reason), or, with null, that it is published again. */
export async function notifySuspension(userId: string, s: { until: Date | null; reason: string }): Promise<void> {
  try {
    const [user] = await db.select({ email: users.email, language: users.language }).from(users).where(eq(users.id, userId))
    if (!user) return
    const lang = isLang(user.language) ? user.language : DEFAULT_LANG
    await sendEmail({
      to: user.email,
      lang,
      template: s.until ? 'suspended' : 'published-again',
      params: { reason: s.reason, date: s.until?.toLocaleDateString(LOCALE[lang]) },
    })
  } catch (e) {
    console.error('[notify] suspension email failed', e instanceof Error ? e.message : 'unknown')
  }
}
