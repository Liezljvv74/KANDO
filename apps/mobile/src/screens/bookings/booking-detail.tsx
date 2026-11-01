import { useLocalSearchParams } from 'expo-router'
import { useCallback, useState } from 'react'
import { StyleSheet, Text } from 'react-native'

import { answerBooking, confirmAgreedTime, confirmJob, getBooking, objectNoShow, openDispute, reportNoShow, startAdditionalTask, stopJob, withdrawBooking } from '@/api/bookings'
import { Button, ErrorText, Info, LinkText } from '@/components/auth-ui'
import { Card, FormScreen } from '@/components/form-ui'
import { ErrorRetry, Loading } from '@/components/state-view'
import { useLoad } from '@/hooks/use-load'
import { useSubmit } from '@/hooks/use-submit'
import { t, useLang, type Key } from '@/i18n'
import { actionLabel, bookingActions, bookingStatusText, daysLeft, type BookingAction } from '@/lib/booking-status'
import { confirmDanger } from '@/lib/confirm'
import { formatWhen } from '@/lib/booking-time'
import { formatPrice } from '@/lib/format'
import { go } from '@/lib/go'
import { placeText } from '@/lib/place'
import { CancelSheet } from '@/screens/bookings/cancel-sheet'
import { DescriptionForm, DisputeInfo } from '@/screens/bookings/dispute-form'
import { FinishSheet } from '@/screens/bookings/finish-sheet'
import { PayPanel } from '@/screens/bookings/pay-card'
import { StopSheet } from '@/screens/bookings/stop-sheet'
import { OpenChat } from '@/screens/chat/open-chat'
import { BookingInvoiceRow } from '@/screens/invoices/invoice-list'
import { ReviewPanel } from '@/screens/reviews/review-form'

/** Actions that open a form or statement below the booking before anything is sent. */
type Sheet = 'counter' | 'finish' | 'cancel' | 'dispute' | 'objectNoShow' | 'additionalTask' | 'stateStopAmount' | 'answerStop'
const SHEETS: readonly BookingAction[] = ['counter', 'finish', 'cancel', 'dispute', 'objectNoShow', 'additionalTask', 'stateStopAmount', 'answerStop']
const DANGER: readonly BookingAction[] = ['decline', 'withdraw', 'cancel']

/** A booking: plain-words status, the proposed time and the actions allowed now. */
export default function BookingDetail() {
  useLang()
  const { id } = useLocalSearchParams<{ id: string }>()
  const fetch = useCallback(() => getBooking(id), [id])
  const { data, done, error, retry } = useLoad(fetch)
  const { busy, problem, submit } = useSubmit()
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const title = t('booking.bookings')
  if (!done || !data)
    return (
      <FormScreen title={title}>
        {error || done ? <ErrorRetry code={error ?? 'Not found'} onRetry={retry} /> : <Loading />}
      </FormScreen>
    )
  const { booking: b, viewer } = data
  const now = new Date()
  const closeAndReload = () => {
    setSheet(null)
    retry()
  }

  /** Steps without a form ask first (they cannot be undone), then call the server. */
  const ASK: Partial<Record<BookingAction, [Key, Key, () => Promise<unknown>]>> = {
    decline: ['booking.confirmDecline', 'booking.decline', () => answerBooking(b.id, { type: 'decline' })],
    withdraw: ['booking.confirmWithdraw', 'booking.withdraw', () => withdrawBooking(b.id)],
    confirm: ['booking.confirmAsk', 'booking.confirmYes', () => confirmJob(b.id)],
    stop: ['booking.stopAsk', 'booking.stopYes', () => stopJob(b.id)],
    reportNoShow: [viewer === 'customer' ? 'booking.noShowAskCustomer' : 'booking.noShowAskProvider', 'booking.noShowYes', () => reportNoShow(b.id)],
  }

  async function act(action: BookingAction) {
    setNotice(null)
    if (action === 'enterTime') return go('/bookings/agreed-time', { id: b.id })
    if (SHEETS.includes(action)) return setSheet(sheet === action ? null : (action as Sheet))
    const ask = ASK[action]
    if (ask && !(await confirmDanger(t(ask[0]), t(ask[1])))) return
    submit(ask ? ask[2] : action === 'confirmTime' ? () => confirmAgreedTime(b.id) : () => answerBooking(b.id, { type: 'accept' }), retry)
  }

  const descriptionSheet = (label: Key, hint: Key | undefined, submitLabel: Key, call: (text: string) => Promise<unknown>, after = closeAndReload) => (
    <DescriptionForm label={t(label)} hint={hint && t(hint)} submitLabel={t(submitLabel)} onSubmit={call} onDone={after} />
  )
  const showDays = viewer === 'customer' && b.status === 'finished' && !!b.confirmBy && daysLeft(b.confirmBy, now) > 0
  const days = b.confirmBy ? daysLeft(b.confirmBy, now) : 0
  const awaitingTime = b.status === 'awaiting-time'
  const pending = awaitingTime ? b.pendingTime : null

  return (
    <FormScreen title={title}>
      <Card>
        {!!b.parentBookingId && <Text style={styles.small}>{t('booking.additionalTask')}</Text>}
        <Text style={styles.status} accessibilityRole="header">
          {bookingStatusText(b, viewer, now)}
        </Text>
        {showDays && <Text style={styles.text}>{days === 1 ? t('booking.daysLeft.one') : t('booking.daysLeft.other', { n: days })}</Text>}
        {awaitingTime ? (
          // the start time stored for an awaiting-time booking is only a stand-in: never shown
          <>
            <Text style={styles.text}>{t('booking.timeNotAgreed')}</Text>
            {!!pending && <Text style={styles.text}>{t(pending.by === viewer ? 'booking.pendingTimeYou' : 'booking.pendingTimeOther', { when: formatWhen(pending.startAt), min: pending.durationMin })}</Text>}
          </>
        ) : (
          <Text style={styles.text}>{`${t('booking.when')}: ${formatWhen(b.startAt)} (${b.durationMin} min)`}</Text>
        )}
        <Text style={styles.text}>{`${t('booking.amount')}: ${formatPrice({ priceType: 'fixed', price: b.amount, currency: b.currency })}`}</Text>
        <Text style={styles.text}>{`${t('booking.mode')}: ${placeText(b.onSite, b.address)}`}</Text>
        {!!b.note && <Text style={styles.small}>{b.note}</Text>}
        {!!b.parentBookingId && <Text style={styles.small}>{t('additionalTask.explainer')}</Text>}
      </Card>
      <PayPanel booking={b} viewer={viewer} onRefresh={retry} />
      <BookingInvoiceRow booking={b} />
      {b.status === 'disputed' && <DisputeInfo booking={b} />}
      {b.status === 'completed' && !b.parentBookingId && <ReviewPanel booking={b} />}
      <OpenChat find={async () => data.threadId} />
      {!!notice && <Info text={notice} />}
      <ErrorText text={problem} />
      {bookingActions(b, viewer, now).map((a) => (
        <Button key={a} label={actionLabel(a, viewer)} onPress={() => act(a)} busy={busy} disabled={sheet !== null && sheet !== a} danger={DANGER.includes(a)} />
      ))}
      {sheet === 'counter' && (
        <>
          <OpenChat find={async () => data.threadId} />
          <Button label={t('booking.counterEnter')} onPress={() => go('/bookings/counter', { id: b.id })} />
        </>
      )}
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
    </FormScreen>
  )
}

const styles = StyleSheet.create({
  status: { fontSize: 18, fontWeight: '700', color: '#0E8A6B' },
  text: { fontSize: 16, color: '#14352E' },
  small: { fontSize: 14, color: '#5C7A72' },
})
