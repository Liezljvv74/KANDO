import { useLocalSearchParams } from 'expo-router'
import { useCallback, useRef, useState, type ComponentRef } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import type { KeyboardAwareScrollView } from 'react-native-keyboard-controller'

import type { Booking, JobStateDto } from '@kando/contract'

import { acceptQuote, confirmQuote, declineRequest, getBooking, getRequest, listQuotes, withdrawRequest } from '@/api/bookings'
import { listQuoteDocuments, quotePdf } from '@/api/quotes'
import { Button, ErrorText, Info, LinkText } from '@/components/auth-ui'
import { Actions, Card, FormScreen, SectionTitle, SmallButton } from '@/components/form-ui'
import { ErrorRetry, Loading } from '@/components/state-view'
import { useLoad } from '@/hooks/use-load'
import { loadMe, markNotificationsSeen, useMe } from '@/hooks/use-me'
import { useSubmit } from '@/hooks/use-submit'
import { t, useLang, type Key } from '@/i18n'
import { font } from '@/theme'
import { requestStateCtx, stateText } from '@/lib/job-state-text'
import { formatWhen } from '@/lib/booking-time'
import { isJobPageNotice } from '@/lib/correspondence'
import { go } from '@/lib/go'
import { confirmDanger } from '@/lib/confirm'
import { placeText } from '@/lib/place'
import { OpenChat } from '@/screens/chat/open-chat'
import { BookingActions, BookingSection, BookingStatusLines, bookingTitle, JobCommonButtons } from '@/screens/bookings/booking-detail'
import { PayPrompt } from '@/screens/bookings/pay-card'
import { JobHeader } from '@/screens/bookings/job-header'
import { LapsedAsk } from '@/screens/bookings/lapse-banner'
import { QuoteCard } from '@/screens/bookings/quote-card'
import { SendQuoteForm } from '@/screens/bookings/send-quote-form'
import { usePdf } from '@/screens/invoices/invoice-list'

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
    const [request, quotes, docs] = await Promise.all([getRequest(id), listQuotes(id), listQuoteDocuments(id).catch(() => [])])
    const bookingIds = request.bookingIds ?? []
    // a booking that cannot be read (e.g. a 404) drops only its own section: the page still shows
    const views = (await Promise.all(bookingIds.map((b) => getBooking(b).catch(() => null)))).filter((v) => v !== null)
    // opening the job page reads its quote and booking notices: they turn seen (the chat's own notices are marked by the chat)
    loadMe()
      .then(() => markNotificationsSeen((n) => isJobPageNotice(n, id, bookingIds)))
      .catch(() => {})
    return { request, quotes, views, docOf: new Map(docs.map((d) => [d.quoteId, d.id])) }
  }, [id])
  const { data, error, retry } = useLoad(fetch)
  const pdf = usePdf()
  const accepting = useSubmit()
  const closing = useSubmit()
  const [payFor, setPayFor] = useState<Booking | null>(null) // the booking to pay, offered right after accepting a quote
  const [chatSeen, setChatSeen] = useState(false) // the chat was opened from here: its unread count is gone
  const [editing, setEditing] = useState(false) // the provider's Edit quote shows the form again
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
  const { request, quotes, views, docOf } = data
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
  const confirm = (quoteId: string) => accepting.submit(async () => {
      const made = await (extra ? acceptQuote(quoteId, {}) : confirmQuote(quoteId))
      if (made.status === 'awaiting-payment') setPayFor(made)
    }, retry)
  const liveQuote = quotes.filter((q) => q.status === 'sent').sort((x, y) => y.version - x.version)[0]
  const head = onBooking && current ? bookingTitle(current, state) : stateText(state, viewer, requestStateCtx(request, liveQuote))
  const close = async () => {
    if (isCustomer && request.status === 'quoted') return setAskChat(true)
    const [ask, yes, call] = isCustomer ? (['request.withdrawConfirm', 'request.withdraw', withdrawRequest] as const) : (['request.declineConfirm', 'request.decline', declineRequest] as const)
    if (await confirmDanger(t(ask), t(yes))) closing.submit(() => call(request.id), retry)
  }
  const quoteOut = !isCustomer && !onBooking && state?.key === 'quote_sent' && !!liveQuote && has('send_quote') // the provider's quote is out: Edit quote / Cancel quote instead of the form
  const cancelQuote = async () => {
    if (await confirmDanger(t('booking.cancelQuoteConfirm'), t('booking.cancelQuote'))) closing.submit(() => declineRequest(request.id), retry)
  }
  const canClose = !onBooking && !quoteOut && (has('decline') || has('cancel'))
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
  const quoteReady = isCustomer && !onBooking && state?.key === 'quote_sent' && has('accept_quote') // the customer's quote waits: a plain heading, the quote card below says the rest
  // a booking is listed once it is paid: not while it waits for the time or the payment
  const listed = views.filter((v) => v.booking.status !== 'awaiting-time' && v.booking.status !== 'awaiting-payment')
  const place = placeText(request.onSite, request.address)
  const common = state && <JobCommonButtons state={state} threadId={request.threadId} unread={chatSeen ? 0 : request.unread} onChatOpened={() => setChatSeen(true)} job={{ number: request.jobNumber, title: request.title }} />
  // the customer's request and quote stage: Withdraw (left) and Open chat (right) close the page; every other job keeps them under the status card
  const atBottom = isCustomer && canClose && !onBooking
  const closeButtons = (
    <>
      <ErrorText text={closing.problem} />
      {canClose && !askChat && (atBottom ? <Actions><SmallButton label={t('request.withdraw')} onPress={close} busy={closing.busy} danger solid grow />{common}</Actions> : <Button label={t(isCustomer ? 'request.withdraw' : 'request.decline')} onPress={close} busy={closing.busy} danger />)}
      {canClose && askChat && (
        <Card>
          <Text style={styles.text}>{t('booking.talkFirst')}</Text>
          {!!request.threadId && <OpenChat find={async () => request.threadId ?? null} />}
          <Button label={t('booking.declineAnyway')} onPress={() => closing.submit(() => withdrawRequest(request.id), retry)} busy={closing.busy} danger />
          <LinkText label={t('common.cancel')} onPress={() => setAskChat(false)} />
        </Card>
      )}
    </>
  )
  return (
    <FormScreen title={request.title ?? t('job.fallbackTitle')} scrollRef={scroll}>
      {payFor && <PayPrompt booking={payFor} onClose={() => setPayFor(null)} onRefresh={retry} />}
      <JobHeader job={headerJob} viewer={viewer} />
      {quoteReady ? (
        <Text style={styles.status} accessibilityRole="header">
          {t('job.quoteReady')}
        </Text>
      ) : (
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
        {!chatSeen && (request.unread ?? 0) > 0 && !!request.threadId && <LinkText label={t('job.newMessage')} onPress={() => { setChatSeen(true); go(`/threads/${request.threadId}`) }} />}
        {onBooking && current && <BookingStatusLines view={current} />}
      </Card>
      )}
      {onBooking && current && state ? <BookingActions view={current} state={state} onChanged={retry} extra={common} /> : !atBottom && <Actions>{common}</Actions>}
      {isCustomer && !!request.lapsed && <LapsedAsk requestId={request.id} onClosed={retry} />}
      {!atBottom && closeButtons}
      <SectionTitle text={t(extra ? 'booking.additionalTaskRequest' : 'job.section.request')} />
      <Card>
        <Text style={styles.text}>{request.description}</Text>
        {!!request.startAt && <Text style={styles.small}>{t('booking.requestedWhen', { when: formatWhen(request.startAt), min: request.durationMin ?? 0 })}</Text>}
        {!!place && <Text style={styles.small}>{place}</Text>}
        {!!request.note && <Text style={styles.small}>{request.note}</Text>}
        {extra && <Text style={styles.small}>{t('additionalTask.explainer')}</Text>}
      </Card>
      <SectionTitle text={t(quotes.length === 1 ? 'booking.quote' : 'booking.quotes')} />
      {quotes.length === 0 && <Text style={styles.small}>{t('booking.noQuotes')}</Text>}
      {quotes.map((q) => {
        const doc = docOf.get(q.id)
        return <QuoteCard key={q.id} quote={q} onConfirm={isCustomer && has('accept_quote') ? () => confirm(q.id) : undefined} busy={accepting.busy} onPdf={doc ? () => pdf.open(doc, () => quotePdf(doc)) : undefined} />
      })}
      <ErrorText text={pdf.problem} />
      {isCustomer && has('accept_quote') && <Info text={t('booking.discussChanges')} />}
      <ErrorText text={accepting.problem} />
      {quoteOut && !editing && (
        <Actions>
          <SmallButton label={t('booking.editQuote')} onPress={() => setEditing(true)} solid grow />
          <SmallButton label={t('booking.cancelQuote')} onPress={cancelQuote} busy={closing.busy} danger solid grow />
        </Actions>
      )}
      {!isCustomer && has('send_quote') && (!quoteOut || editing) && (
        <>
          <SendQuoteForm request={request} onSent={() => { setEditing(false); retry() }} />
          {editing && <LinkText label={t('common.cancel')} onPress={() => setEditing(false)} />}
        </>
      )}
      {listed.length > 0 && <SectionTitle text={t(listed.length === 1 ? 'booking.booking' : 'booking.bookings')} />}
      {[...listed].reverse().map((v) => (
        <View key={v.booking.id} onLayout={(e) => onLayoutOf(v.booking.id)(e.nativeEvent.layout.y)} style={styles.section}>
          <BookingSection view={v} showTitle={v.booking.id !== b?.id} />
        </View>
      ))}
      {!!request.tasks?.length && <SectionTitle text={t('job.section.tasks')} />}
      {request.tasks?.map((task, n) => (
        // spec 4.3: each additional task is part of the job; its own page has its quote, payment and buttons
        <LinkText key={task.id} label={t('job.taskLink', { n: n + 1, status: stateText(task.jobState, viewer)?.title ?? t('booking.additionalTask') })} onPress={() => go(`/bookings/request/${task.id}`)} />
      ))}
      {atBottom && closeButtons}
    </FormScreen>
  )
}

const styles = StyleSheet.create({
  status: { fontSize: 18, fontFamily: font.heading, color: '#34328A' },
  text: { fontSize: 16, color: '#1D1C4A' },
  small: { fontSize: 14, color: '#4F4E7D' },
  section: { gap: 8 },
})
