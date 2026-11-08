import { useLocalSearchParams } from 'expo-router'
import { useCallback, useRef, useState, type ComponentRef } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import type { KeyboardAwareScrollView } from 'react-native-keyboard-controller'

import type { JobStateDto } from '@kando/contract'

import { acceptQuote, confirmQuote, declineRequest, getBooking, getRequest, listQuotes, withdrawRequest } from '@/api/bookings'
import { Button, ErrorText, Info, LinkText } from '@/components/auth-ui'
import { Card, FormScreen, SectionTitle } from '@/components/form-ui'
import { ErrorRetry, Loading } from '@/components/state-view'
import { useLoad } from '@/hooks/use-load'
import { useMe } from '@/hooks/use-me'
import { useSubmit } from '@/hooks/use-submit'
import { t, useLang, type Key } from '@/i18n'
import { font } from '@/theme'
import { requestStateCtx, stateText } from '@/lib/job-state-text'
import { formatWhen } from '@/lib/booking-time'
import { confirmDanger } from '@/lib/confirm'
import { placeText } from '@/lib/place'
import { OpenChat } from '@/screens/chat/open-chat'
import { BookingActions, BookingSection, BookingStatusLines, bookingTitle, JobCommonButtons } from '@/screens/bookings/booking-detail'
import { JobHeader } from '@/screens/bookings/job-header'
import { LapsedAsk } from '@/screens/bookings/lapse-banner'
import { QuoteCard } from '@/screens/bookings/quote-card'
import { SendQuoteForm } from '@/screens/bookings/send-quote-form'

/** The states a request has before (or again without) a live booking: their buttons act on the request, not on a booking. */
const REQUEST_KEYS: readonly string[] = ['request_sent', 'quote_sent', 'declined_expired']

/**
 * The job page (spec 4.3): the header, the status card with the buttons the server sends (`jobState.buttons` only), then the request,
 * its quotes and each booking of the job as a section, newest first. `?booking=` (from /bookings/[id]) scrolls to that booking.
 */
export default function RequestDetail() {
  useLang()
  const { id, booking: focus } = useLocalSearchParams<{ id: string; booking?: string }>()
  const me = useMe()
  const fetch = useCallback(async () => {
    const [request, quotes] = await Promise.all([getRequest(id), listQuotes(id)])
    const views = await Promise.all((request.bookingIds ?? []).map((b) => getBooking(b)))
    return { request, quotes, views }
  }, [id])
  const { data, error, retry } = useLoad(fetch)
  const accepting = useSubmit()
  const closing = useSubmit()
  const [askChat, setAskChat] = useState(false) // the customer's Withdraw on a quote offers the chat first
  const scroll = useRef<ComponentRef<typeof KeyboardAwareScrollView>>(null)
  const scrolled = useRef(false)
  if (error && !data)
    return (
      <FormScreen title={t('job.fallbackTitle')}>
        <ErrorRetry code={error} onRetry={retry} />
      </FormScreen>
    )
  if (!data || !me)
    return (
      <FormScreen title={t('job.fallbackTitle')}>
        <Loading />
      </FormScreen>
    )
  const { request, quotes, views } = data
  const isCustomer = request.customerId === me.id
  const viewer = isCustomer ? 'customer' : 'provider'
  const state = request.jobState
  const has = (x: JobStateDto['buttons'][number]) => !!state?.buttons.includes(x)
  const current = views.find((v) => v.booking.id === request.currentBookingId)
  const b = current?.booking
  // the buttons act on the current booking, except in the request's own states (an awaiting-time booking reads quote_sent: still the booking's)
  const onBooking = !!b && !!state && (!REQUEST_KEYS.includes(state.key) || b.status === 'awaiting-time')
  const extra = !!request.parentBookingId
  // an additional task's quote takes the booking's time; an ordinary one is confirmed as it is. Either way the booking joins this page.
  const confirm = (quoteId: string) => accepting.submit(() => (extra ? acceptQuote(quoteId, {}) : confirmQuote(quoteId)), retry)
  const liveQuote = quotes.filter((q) => q.status === 'sent').sort((x, y) => y.version - x.version)[0]
  const head = onBooking && current ? bookingTitle(current, state) : stateText(state, viewer, requestStateCtx(request, liveQuote))
  const close = async () => {
    if (isCustomer && request.status === 'quoted') return setAskChat(true)
    const [ask, yes, call] = isCustomer ? (['request.withdrawConfirm', 'request.withdraw', withdrawRequest] as const) : (['request.declineConfirm', 'request.decline', declineRequest] as const)
    if (await confirmDanger(t(ask), t(yes))) closing.submit(() => call(request.id), retry)
  }
  const canClose = !onBooking && (has('decline') || has('cancel'))
  const agreed = !!b && b.status !== 'awaiting-time' // an awaiting-time booking's start is a stand-in: not shown
  const headerJob = {
    jobNumber: request.jobNumber,
    otherParty: request.otherParty,
    startAt: agreed ? b.startAt : b ? null : request.startAt,
    durationMin: agreed ? b.durationMin : b ? null : request.durationMin,
    onSite: b ? b.onSite : request.onSite,
    address: b ? b.address : request.address,
  }
  const onLayoutOf = (bookingId: string) => (y: number) => {
    if (bookingId !== focus || scrolled.current) return
    scrolled.current = true
    scroll.current?.scrollTo({ y, animated: true })
  }
  const place = placeText(request.onSite, request.address)
  return (
    <FormScreen title={request.title ?? t('job.fallbackTitle')} scrollRef={scroll}>
      <JobHeader job={headerJob} viewer={viewer} />
      <Card>
        {head ? (
          <>
            <Text style={styles.status} accessibilityRole="header">
              {head.title}
            </Text>
            {!!head.body && <Text style={styles.small}>{head.body}</Text>}
          </>
        ) : (
          // an older server without a state
          <Text style={styles.small}>{t(`requestStatus.${request.status}` as Key)}</Text>
        )}
        {onBooking && current && <BookingStatusLines view={current} />}
      </Card>
      {onBooking && current && state && <BookingActions view={current} state={state} onChanged={retry} />}
      {state && <JobCommonButtons state={state} threadId={request.threadId} job={{ number: request.jobNumber, title: request.title }} />}
      {isCustomer && !!request.lapsed && <LapsedAsk requestId={request.id} onClosed={retry} />}
      <ErrorText text={closing.problem} />
      {canClose && !askChat && <Button label={t(isCustomer ? 'request.withdraw' : 'request.decline')} onPress={close} busy={closing.busy} danger />}
      {canClose && askChat && (
        <Card>
          <Text style={styles.text}>{t('booking.talkFirst')}</Text>
          {!!request.threadId && <OpenChat find={async () => request.threadId ?? null} />}
          <Button label={t('booking.declineAnyway')} onPress={() => closing.submit(() => withdrawRequest(request.id), retry)} busy={closing.busy} danger />
          <LinkText label={t('common.cancel')} onPress={() => setAskChat(false)} />
        </Card>
      )}
      <SectionTitle text={t(extra ? 'booking.additionalTaskRequest' : 'job.section.request')} />
      <Card>
        <Text style={styles.text}>{request.description}</Text>
        {!!request.startAt && <Text style={styles.small}>{t('booking.requestedWhen', { when: formatWhen(request.startAt), min: request.durationMin ?? 0 })}</Text>}
        {!!place && <Text style={styles.small}>{place}</Text>}
        {!!request.note && <Text style={styles.small}>{request.note}</Text>}
        {extra && <Text style={styles.small}>{t('additionalTask.explainer')}</Text>}
      </Card>
      <SectionTitle text={t('booking.quotes')} />
      {quotes.length === 0 && <Text style={styles.small}>{t('booking.noQuotes')}</Text>}
      {quotes.map((q) => (
        <QuoteCard key={q.id} quote={q} onConfirm={isCustomer && has('accept_quote') ? () => confirm(q.id) : undefined} busy={accepting.busy} />
      ))}
      {isCustomer && has('accept_quote') && <Info text={t('booking.discussChanges')} />}
      <ErrorText text={accepting.problem} />
      {!isCustomer && has('send_quote') && <SendQuoteForm request={request} onSent={retry} />}
      {views.length > 0 && <SectionTitle text={t('booking.bookings')} />}
      {[...views].reverse().map((v) => (
        <View key={v.booking.id} onLayout={(e) => onLayoutOf(v.booking.id)(e.nativeEvent.layout.y)} style={styles.section}>
          <BookingSection view={v} showTitle={v.booking.id !== b?.id} />
        </View>
      ))}
    </FormScreen>
  )
}

const styles = StyleSheet.create({
  status: { fontSize: 18, fontFamily: font.heading, color: '#34328A' },
  text: { fontSize: 16, color: '#1D1C4A' },
  small: { fontSize: 14, color: '#4F4E7D' },
  section: { gap: 8 },
})
