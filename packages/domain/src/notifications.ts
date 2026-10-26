import { eq } from 'drizzle-orm'
import { db, users } from '@kando/db'
import { isLang } from '@kando/i18n'
import { sendEmail } from './email'

/** What a staff decision on a document tells the owner. */
export type DocumentDecision = { id: string; requirement: string; status: 'approved' | 'rejected'; note: string | null }

export async function notifyDocumentDecision(userId: string, document: DocumentDecision): Promise<void> {
  const [user] = await db.select({ email: users.email, language: users.language }).from(users).where(eq(users.id, userId))
  if (!user) return
  await sendEmail({
    to: user.email,
    lang: isLang(user.language) ? user.language : 'de',
    template: document.status === 'approved' ? 'document-approved' : 'document-rejected',
    params: { requirement: document.requirement, note: document.note },
  })
}
