import { Resend } from 'resend'
import { deferSend } from './deferred-sends'
import { describeError } from './log-error'
import { LATE_CANCEL_SHARE } from '@kando/contract'
import { t, type Lang } from '@kando/i18n'

const FROM = 'SkillWeb <noreply@skillweb.space>'
const REPLY_TO = 'info@skillweb.space'
const APP_LINK = 'skilled://my-profile'

/** One email per booking event kind (see bookings/notify.ts). */
export type BookingTemplate = 'request-received' | 'quote-received' | 'booking-proposed' | 'booking-accepted' | 'booking-declined' | 'booking-expired' | 'payment-reminder' | 'quote-expiring' | 'request-expired' | 'requests-ignored' | 'pending-slot-requested' | 'message-received' | 'payment-received' | 'booking-paid' | 'payment-late-refunded' | 'payout-setup-complete' | 'customers-waiting' | 'provider-available' | 'job-finished' | 'confirm-reminder' | 'payment-released' | 'was-job-done' | 'review-requested' | 'booking-cancelled' | 'no-show-reported' | 'provider-warning' | 'dispute-opened' | 'job-stopped' | 'stop-amount-stated' | 'additional-task-requested' | 'dispute-decided' | 'refund-issued' | 'review-visible' | 'invoice-ready' | 'commission-invoice-ready' | 'request-withdrawn' | 'request-declined' | 'request-reopened'
export type Template = 'document-approved' | 'document-rejected' | 'document-approved-visible' | 'document-approved-offline' | 'document-approved-suspended' | 'profile-live' | 'suspended' | 'published-again' | 'account-deleted' | 'account-deleted-retained' | 'payment-released-provider' | 'additional-task-requested-provider' | 'payment-released-stop' | 'payment-released-stop-provider' | 'payment-released-stop-refund' | 'payment-released-stop-refund-provider' | 'refund-issued-provider' | CancelTemplate | BookingTemplate
/** booking-cancelled variants (bookings/cancel.ts: who cancelled, what happens to the money). */
export type CancelTemplate = 'booking-cancelled-late' | 'booking-cancelled-by-provider' | 'booking-cancelled-no-show-customer' | 'booking-cancelled-no-show-provider'
type Params = Record<string, string | null | undefined>
export type Mail = { to: string; from: string; replyTo: string; subject: string; text: string; html: string }

const outbox: Mail[] = []
export const outboxForTests = () => outbox
export const clearOutbox = () => {
  outbox.length = 0
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The catalogue prefix of each template (`<key>.subject`, `<key>.body`). */
export const EMAIL_KEYS: Record<Template, string> = {
  'document-approved': 'email.documentApproved',
  'document-rejected': 'email.documentRejected',
  'document-approved-visible': 'email.documentApproved.visible',
  'document-approved-offline': 'email.documentApproved.offline',
  'document-approved-suspended': 'email.documentApproved.suspended',
  'profile-live': 'email.profileLive',
  suspended: 'email.suspended',
  'published-again': 'email.publishedAgain',
  'account-deleted': 'email.accountDeleted',
  'account-deleted-retained': 'email.accountDeleted.retained',
  'request-received': 'email.requestReceived',
  'quote-received': 'email.quoteReceived',
  'booking-proposed': 'email.bookingProposed',
  'booking-accepted': 'email.bookingAccepted',
  'booking-declined': 'email.bookingDeclined',
  'booking-expired': 'email.bookingExpired',
  'payment-reminder': 'email.paymentReminder',
  'quote-expiring': 'email.quoteExpiring',
  'request-expired': 'email.requestExpired',
  'requests-ignored': 'email.requestsIgnored',
  'pending-slot-requested': 'email.pendingSlotRequested',
  'message-received': 'email.messageReceived',
  'payment-received': 'email.paymentReceived',
  'booking-paid': 'email.bookingPaid',
  'payment-late-refunded': 'email.paymentLateRefunded',
  'payout-setup-complete': 'email.payoutSetupComplete',
  'customers-waiting': 'email.customersWaiting',
  'provider-available': 'email.providerAvailable',
  'job-finished': 'email.jobFinished',
  'confirm-reminder': 'email.confirmReminder',
  'payment-released': 'email.paymentReleased',
  'payment-released-provider': 'email.paymentReleased.provider',
  'was-job-done': 'email.wasJobDone',
  'review-requested': 'email.reviewRequested',
  'booking-cancelled': 'email.bookingCancelled',
  'booking-cancelled-late': 'email.bookingCancelled.late',
  'booking-cancelled-by-provider': 'email.bookingCancelled.byProvider',
  'booking-cancelled-no-show-customer': 'email.bookingCancelled.noShowCustomer',
  'booking-cancelled-no-show-provider': 'email.bookingCancelled.noShowProvider',
  'no-show-reported': 'email.noShowReported',
  'provider-warning': 'email.providerWarning',
  'payment-released-stop': 'email.paymentReleased.stop',
  'payment-released-stop-provider': 'email.paymentReleased.stop.provider',
  'payment-released-stop-refund': 'email.paymentReleased.stopRefund',
  'payment-released-stop-refund-provider': 'email.paymentReleased.stopRefund.provider',
  'dispute-opened': 'email.disputeOpened',
  'job-stopped': 'email.jobStopped',
  'stop-amount-stated': 'email.stopAmountStated',
  'additional-task-requested': 'email.additionalTaskRequested',
  'additional-task-requested-provider': 'email.additionalTaskRequested.provider',
  'dispute-decided': 'email.disputeDecided',
  'refund-issued': 'email.refundIssued',
  'refund-issued-provider': 'email.refundIssued.provider',
  'review-visible': 'email.reviewVisible',
  'invoice-ready': 'email.invoiceReady',
  'commission-invoice-ready': 'email.commissionInvoiceReady',
  'request-withdrawn': 'email.requestWithdrawn',
  'request-declined': 'email.requestDeclined',
  'request-reopened': 'email.requestReopened',
}

function compose(lang: Lang, template: Template, params: Params) {
  const key = EMAIL_KEYS[template]
  const document = params.requirement ? t(lang, `admin.requirement.${params.requirement}` as Parameters<typeof t>[1]) : ''
  const text = `${t(lang, `${key}.body` as Parameters<typeof t>[1], { document, note: params.note ?? '', reason: params.reason ?? '', date: params.date ?? '', category: params.category ?? '', url: params.url ?? '', months: params.months ?? '', count: params.count ?? '', percent: String(Math.round(LATE_CANCEL_SHARE * 100)), contact: REPLY_TO })}${template.startsWith('account-deleted') ? '' : `\n\n${APP_LINK}`}`
  const html = `<p>${esc(text).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>`
  return { subject: t(lang, `${key}.subject` as Parameters<typeof t>[1]), text, html }
}

let client: Resend | undefined
/** A Resend call that has not answered by then is given up (logged), so a hanging mail service never holds a request or a cron run. */
export const EMAIL_TIMEOUT_MS = 10_000
type EmailArgs = { to: string; lang: Lang; template: Template; params: Params }

/**
 * Sends through Resend; with no RESEND_API_KEY it logs one line (and in tests records the mail in the outbox). Inside a
 * request (withDeferredSends) it is only queued and goes out after the answer. Never throws.
 */
export async function sendEmail(args: EmailArgs): Promise<void> {
  if (deferSend(() => deliverEmail(args))) return
  await deliverEmail(args)
}

async function deliverEmail(args: EmailArgs): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
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
    const timeout = new Promise<'timeout'>((resolve) => (timer = setTimeout(() => resolve('timeout'), EMAIL_TIMEOUT_MS)))
    const result = await Promise.race([client.emails.send({ from: mail.from, to: mail.to, replyTo: mail.replyTo, subject: mail.subject, text: mail.text, html: mail.html }), timeout])
    if (result === 'timeout') console.error('[email] send failed timeout')
    else if (result.error) console.error('[email] send failed', result.error.name)
  } catch (e) {
    console.error(`[email] send failed ${describeError(e)}`)
  } finally {
    clearTimeout(timer)
  }
}
