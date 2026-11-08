import { useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { StyleSheet, Text } from 'react-native'

import type { BookingView, JobStateDto } from '@kando/contract'

import { confirmAgreedTime, confirmJob, getBooking, objectNoShow, openDispute, reportNoShow, startAdditionalTask, stopJob, withdrawBooking } from '@/api/bookings'
import { Button, ErrorText, Info, LinkText } from '@/components/auth-ui'
import { Card, FormScreen } from '@/components/form-ui'
import { ErrorRetry, Loading } from '@/components/state-view'
import { useLoad } from '@/hooks/use-load'
import { useSubmit } from '@/hooks/use-submit'
import { t, useLang, type Key } from '@/i18n'
import { actionLabel, BUTTON_ACTION, bookingStatusText, daysLeft, type BookingAction } from '@/lib/booking-status'
import { confirmDanger } from '@/lib/confirm'
import { doQuoteStep } from '@/lib/do-quote-step'
import { formatWhen } from '@/lib/booking-time'
import { formatPrice } from '@/lib/format'
import { go, goReplace } from '@/lib/go'
import { bookingStateCtx, stateText } from '@/lib/job-state-text'
import { openSupport } from '@/lib/support'
import { placeText } from '@/lib/place'
import { CancelSheet } from '@/screens/bookings/cancel-sheet'
import { DescriptionForm, DisputeInfo } from '@/screens/bookings/dispute-form'
import { FinishSheet } from '@/screens/bookings/finish-sheet'
import { JobHeader } from '@/screens/bookings/job-header'
import { PayPanel } from '@/screens/bookings/pay-card'
import { StopSheet } from '@/screens/bookings/stop-sheet'
import { OpenChat } from '@/screens/chat/open-chat'
import { BookingInvoiceRow } from '@/screens/invoices/invoice-list'
import { ReviewPanel } from '@/screens/reviews/review-form'
import { font } from '@/theme'

/** Actions that open a form or statement below the buttons before anything is sent. */
type Sheet = 'finish' | 'cancel' | 'dispute' | 'objectNoShow' | 'additionalTask' | 'stateStopAmount' | 'answerStop'
const SHEETS: readonly BookingAction[] = ['finish', 'cancel', 'dispute', 'objectNoShow', 'additionalTask', 'stateStopAmount', 'answerStop']
const DANGER: readonly BookingAction[] = ['withdraw', 'cancel']

/** The status title and body of a booking's state (an older server without a state, or an awaiting-time booking: the old status line). */
export function bookingTitle(view: BookingView, state: JobStateDto | undefined = view.booking.jobState): { title: string; body: string } {
  const b = view.booking
  const text = stateText(state, view.viewer, bookingStateCtx({ ...b, jobState: state }))
  // an awaiting-time booking reads as its own status, not as the "quote" it is derived to
  return text && !(b.status === 'awaiting-time' && state?.key === 'quote_sent') ? text : { title: bookingStatusText(b, view.viewer), body: '' }
}

/** The status card's extra lines for a booking: a problem's detail, the days left to confirm, an awaiting-time booking's proposed time. */
export function BookingStatusLines({ view }: { view: BookingView }) {
  const { booking: b, viewer } = view
  const days = b.confirmBy ? daysLeft(b.confirmBy) : 0
  const pending = b.status === 'awaiting-time' ? b.pendingTime : null
  return (
    <>
      {b.jobState?.key === 'problem_reported' && <Text style={styles.small}>{bookingStatusText(b, viewer)}</Text>}
      {viewer === 'customer' && b.status === 'finished' && days > 0 && <Text style={styles.text}>{days === 1 ? t('booking.daysLeft.one') : t('booking.daysLeft.other', { n: days })}</Text>}
      {b.status === 'awaiting-time' && <Text style={styles.text}>{t('booking.timeNotAgreed')}</Text>}
      {!!pending && <Text style={styles.text}>{t(pending.by === viewer ? 'booking.pendingTimeYou' : 'booking.pendingTimeOther', { when: formatWhen(pending.startAt), min: pending.durationMin })}</Text>}
    </>
  )
}

/** One booking of the job as a section: its number, time, amount, place and note, its receipts, dispute and review. No buttons. */
export function BookingSection({ view, showTitle }: { view: BookingView; showTitle?: boolean }) {
  const b = view.booking
  return (
    <>
      <Card>
        {!!b.taskNumber && <Text style={styles.small}>{`${t(b.parentBookingId ? 'booking.additionalTask' : 'booking.bookings')} ${b.taskNumber}`}</Text>}
        {!!view.quoteNumber && <Text style={styles.small}>{`${t('quote.label')} ${view.quoteNumber}`}</Text>}
        {showTitle && <Text style={styles.small}>{bookingTitle(view).title}</Text>}
        {/* the start time stored for an awaiting-time booking is only a stand-in: never shown */}
        {b.status !== 'awaiting-time' && <Text style={styles.text}>{`${t('booking.when')}: ${formatWhen(b.startAt)} (${b.durationMin} min)`}</Text>}
        <Text style={styles.text}>{`${t('booking.amount')}: ${formatPrice({ priceType: 'fixed', price: b.amount, currency: b.currency })}`}</Text>
        <Text style={styles.text}>{`${t('booking.mode')}: ${placeText(b.onSite, b.address)}`}</Text>
        {!!b.note && <Text style={styles.small}>{b.note}</Text>}
        {!!b.parentBookingId && <Text style={styles.small}>{t('additionalTask.explainer')}</Text>}
      </Card>
      <BookingInvoiceRow booking={b} />
      {b.status === 'disputed' && <DisputeInfo booking={b} />}
      {b.status === 'completed' && !b.parentBookingId && <ReviewPanel booking={b} />}
    </>
  )
}

/**
 * The job's buttons that act on its current booking, from the server's `buttons` only (no rule of its own): pay, set up payouts and
 * the booking steps with their forms. "Job finished" before the start time shows greyed (the status card's line names the time).
 */
export function BookingActions({ view, state, onChanged }: { view: BookingView; state: JobStateDto; onChanged: () => void }) {
  const { booking: b, viewer } = view
  const { busy, problem, submit } = useSubmit()
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const closeAndReload = () => {
    setSheet(null)
    onChanged()
  }
  /** Steps without a form ask first (they cannot be undone), then call the server. */
  const ASK: Partial<Record<BookingAction, [Key, Key, () => Promise<unknown>]>> = {
    withdraw: ['booking.confirmWithdraw', 'booking.withdraw', () => withdrawBooking(b.id)],
    confirm: ['booking.confirmAsk', 'booking.confirmYes', () => confirmJob(b.id)],
    stop: ['booking.stopAsk', 'booking.stopYes', () => stopJob(b.id)],
    reportNoShow: [viewer === 'customer' ? 'booking.noShowAskCustomer' : 'booking.noShowAskProvider', 'booking.noShowYes', () => reportNoShow(b.id)],
  }
  async function act(action: BookingAction) {
    setNotice(null)
    if (action === 'enterTime') return go('/bookings/agreed-time', { id: b.id, onSite: b.onSite ? '1' : '0' })
    if (SHEETS.includes(action)) return setSheet(sheet === action ? null : (action as Sheet))
    const ask = ASK[action]
    if (ask && !(await confirmDanger(t(ask[0]), t(ask[1])))) return
    if (ask) return submit(ask[2], onChanged)
    if (action === 'confirmTime') return submit(() => confirmAgreedTime(b.id), onChanged)
  }
  const descriptionSheet = (label: Key, hint: Key | undefined, submitLabel: Key, call: (text: string) => Promise<unknown>, after = closeAndReload) => (
    <DescriptionForm label={t(label)} hint={hint && t(hint)} submitLabel={t(submitLabel)} onSubmit={call} onDone={after} />
  )
  const early = state.key === 'before_start_time' // "Job finished" opens at the start time; the status card above names the time (said once)
  const actions = state.buttons.flatMap((x) => BUTTON_ACTION[x] ?? [])
  return (
    <>
      {state.buttons.includes('pay') && <PayPanel booking={b} viewer={viewer} onRefresh={onChanged} />}
      {state.buttons.includes('set_up_payouts') && <Button label={t('payouts.setUp')} onPress={() => submit(() => doQuoteStep('payout'), onChanged)} busy={busy} />}
      {!!notice && <Info text={notice} />}
      <ErrorText text={problem} />
      {actions.map((a) => (
        <Button key={a} label={actionLabel(a, viewer)} onPress={() => act(a)} busy={busy} disabled={(early && a === 'finish') || (sheet !== null && sheet !== a)} danger={DANGER.includes(a)} />
      ))}
      {sheet === 'finish' && <FinishSheet booking={b} onDone={closeAndReload} />}
      {sheet === 'cancel' && <CancelSheet booking={b} viewer={viewer} onDone={closeAndReload} onClose={() => setSheet(null)} />}
      {(sheet === 'stateStopAmount' || sheet === 'answerStop') && <StopSheet booking={b} mode={sheet === 'answerStop' ? 'answer' : 'state'} onDone={closeAndReload} />}
      {sheet === 'dispute' && descriptionSheet('booking.disputeField', 'booking.disputeHint', 'booking.disputeSend', (text) => openDispute(b.id, text))}
      {sheet === 'objectNoShow' && descriptionSheet('booking.objectField', 'booking.objectHint', 'booking.objectSend', (text) => objectNoShow(b.id, text))}
      {sheet === 'additionalTask' &&
        descriptionSheet('booking.additionalTaskField', 'additionalTask.explainer', 'booking.additionalTaskSend', (text) => startAdditionalTask(b.id, text), () => {
          setSheet(null)
          setNotice(t('booking.additionalTaskSent'))
        })}
      {sheet !== null && <LinkText label={t('common.close')} onPress={() => setSheet(null)} />}
    </>
  )
}

/** The buttons a job has whatever it acts on: chat, contact support, ask someone else. */
export function JobCommonButtons({ state, threadId, job }: { state: JobStateDto; threadId: string | null | undefined; job: { number?: number; title?: string } }) {
  const has = (x: JobStateDto['buttons'][number]) => state.buttons.includes(x)
  return (
    <>
      {(has('open_chat') || has('ask_question')) && <OpenChat find={async () => threadId ?? null} />}
      {has('contact_support') && <Button label={t('job.button.contactSupport')} onPress={() => openSupport(job)} />}
      {has('ask_someone_else') && <Button label={t('job.button.askSomeoneElse')} onPress={() => go('/search')} />}
    </>
  )
}

/**
 * `/bookings/[id]` stays for push links and installed builds: a booking made from a request (the current one or an older one, or an
 * additional task's) opens its job page, scrolled to it. A direct booking (no request) is shown here on its own.
 */
export default function BookingDetail() {
  useLang()
  const { id } = useLocalSearchParams<{ id: string }>()
  const fetch = useCallback(() => getBooking(id), [id])
  const { data, done, error, retry } = useLoad(fetch)
  const requestId = data?.booking.requestId
  useEffect(() => {
    if (requestId) goReplace(`/bookings/request/${requestId}`, { booking: id })
  }, [requestId, id])
  const title = t('booking.bookings')
  if (!done || !data || requestId)
    return (
      <FormScreen title={title}>
        {!requestId && (error || done) ? <ErrorRetry code={error ?? 'Not found'} onRetry={retry} /> : <Loading />}
      </FormScreen>
    )
  const b = data.booking
  const head = bookingTitle(data)
  const unsure = b.status === 'awaiting-time'
  return (
    <FormScreen title={b.title ?? title}>
      <JobHeader viewer={data.viewer} job={{ jobNumber: b.jobNumber, startAt: unsure ? null : b.startAt, durationMin: unsure ? null : b.durationMin, onSite: b.onSite, address: b.address }} />
      <Card>
        <Text style={styles.status} accessibilityRole="header">
          {head.title}
        </Text>
        {!!head.body && <Text style={styles.text}>{head.body}</Text>}
        <BookingStatusLines view={data} />
      </Card>
      {b.jobState && <BookingActions view={data} state={b.jobState} onChanged={retry} />}
      {b.jobState && <JobCommonButtons state={b.jobState} threadId={data.threadId} job={{ number: b.jobNumber, title: b.title }} />}
      <BookingSection view={data} />
    </FormScreen>
  )
}

const styles = StyleSheet.create({
  status: { fontSize: 18, fontFamily: font.heading, color: '#34328A' },
  text: { fontSize: 16, color: '#1D1C4A' },
  small: { fontSize: 14, color: '#4F4E7D' },
})
