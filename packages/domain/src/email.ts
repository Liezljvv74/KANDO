import { Resend } from 'resend'
import { t, type Lang } from '@kando/i18n'

const FROM = 'SkillWeb <noreply@skillweb.space>'
const REPLY_TO = 'info@skillweb.space'
const APP_LINK = 'skillweb://my-profile'

export type Template = 'document-approved' | 'document-rejected' | 'suspended' | 'published-again'
type Params = Record<string, string | null | undefined>
export type Mail = { to: string; from: string; replyTo: string; subject: string; text: string; html: string }

const outbox: Mail[] = []
export const outboxForTests = () => outbox
export const clearOutbox = () => {
  outbox.length = 0
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const KEY: Record<Template, string> = {
  'document-approved': 'email.documentApproved',
  'document-rejected': 'email.documentRejected',
  suspended: 'email.suspended',
  'published-again': 'email.publishedAgain',
}

function compose(lang: Lang, template: Template, params: Params) {
  const key = KEY[template]
  const document = params.requirement ? t(lang, `admin.requirement.${params.requirement}` as Parameters<typeof t>[1]) : ''
  const text = `${t(lang, `${key}.body` as Parameters<typeof t>[1], { document, note: params.note ?? '', reason: params.reason ?? '', date: params.date ?? '' })}\n\n${APP_LINK}`
  const html = `<p>${esc(text).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>`
  return { subject: t(lang, `${key}.subject` as Parameters<typeof t>[1]), text, html }
}

let client: Resend | undefined

/** Sends through Resend; with no RESEND_API_KEY it logs one line (and in tests records the mail in the outbox). Never throws. */
export async function sendEmail(args: { to: string; lang: Lang; template: Template; params: Params }): Promise<void> {
  try {
    const mail: Mail = { to: args.to, from: FROM, replyTo: REPLY_TO, ...compose(args.lang, args.template, args.params) }
    const key = process.env.RESEND_API_KEY
    if (!key) {
      // Never the recipient or the text in the log; the outbox is for tests only (in production it would only grow).
      console.log(`[email] not sent (no RESEND_API_KEY): ${args.template}`)
      if (process.env.VITEST || process.env.NODE_ENV === 'test') outbox.push(mail)
      return
    }
    client ??= new Resend(key)
    const { error } = await client.emails.send({ from: mail.from, to: mail.to, replyTo: mail.replyTo, subject: mail.subject, text: mail.text, html: mail.html })
    if (error) console.error('[email] send failed', error.name)
  } catch (e) {
    console.error('[email] send failed', e instanceof Error ? e.message : 'unknown')
  }
}
