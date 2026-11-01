import { useLocalSearchParams } from 'expo-router'
import { useCallback, useState } from 'react'
import { StyleSheet, Text } from 'react-native'

import { acceptQuote, confirmQuote, declineRequest, getRequest, listQuotes, withdrawRequest } from '@/api/bookings'
import { Button, ErrorText, Info, LinkText } from '@/components/auth-ui'
import { Card, FormScreen, SectionTitle } from '@/components/form-ui'
import { ErrorRetry, Loading } from '@/components/state-view'
import { useLoad } from '@/hooks/use-load'
import { useMe } from '@/hooks/use-me'
import { useSubmit } from '@/hooks/use-submit'
import { t, useLang, type Key } from '@/i18n'
import { formatWhen } from '@/lib/booking-time'
import { confirmDanger } from '@/lib/confirm'
import { goReplace } from '@/lib/go'
import { placeText } from '@/lib/place'
import { OpenChat } from '@/screens/chat/open-chat'
import { QuoteCard } from '@/screens/bookings/quote-card'
import { SendQuoteForm } from '@/screens/bookings/send-quote-form'

/** A request with its quotes; the provider can send a quote, the customer can accept one. */
export default function RequestDetail() {
  useLang()
  const { id } = useLocalSearchParams<{ id: string }>()
  const me = useMe()
  const fetch = useCallback(() => Promise.all([getRequest(id), listQuotes(id)]), [id])
  const { data, error, retry } = useLoad(fetch)
  const accepting = useSubmit()
  const closing = useSubmit()
  const [askChat, setAskChat] = useState(false) // the customer's Decline offers the chat first
  const title = t('booking.requests')
  if (error && !data)
    return (
      <FormScreen title={title}>
        <ErrorRetry code={error} onRetry={retry} />
      </FormScreen>
    )
  if (!data || !me)
    return (
      <FormScreen title={title}>
        <Loading />
      </FormScreen>
    )
  const [request, quotes] = data
  const isCustomer = request.customerId === me.id
  const open = request.status === 'open' || request.status === 'quoted'
  // The customer confirms the quote as it is: the booking then waits for payment (the quote has a time) or for the agreed time. An additional task's quote takes the booking's time.
  const extra = !!request.parentBookingId
  const confirm = (quoteId: string) => accepting.submit(async () => goReplace(`/bookings/${(await (extra ? acceptQuote(quoteId, {}) : confirmQuote(quoteId))).id}`))
  const quoted = request.status === 'quoted'
  const place = placeText(request.onSite, request.address)
  const close = async () => {
    if (isCustomer && quoted) return setAskChat(true)
    const [ask, yes, call] = isCustomer ? (['request.withdrawConfirm', 'request.withdraw', withdrawRequest] as const) : (['request.declineConfirm', 'request.decline', declineRequest] as const)
    if (await confirmDanger(t(ask), t(yes))) closing.submit(() => call(request.id), retry)
  }
  return (
    <FormScreen title={title}>
      <Card>
        {extra && <Text style={styles.small}>{t('booking.additionalTaskRequest')}</Text>}
        <Text style={styles.text}>{request.description}</Text>
        {!!request.startAt && <Text style={styles.small}>{t('booking.requestedWhen', { when: formatWhen(request.startAt), min: request.durationMin ?? 0 })}</Text>}
        {!!place && <Text style={styles.small}>{place}</Text>}
        {!!request.note && <Text style={styles.small}>{request.note}</Text>}
        {extra && <Text style={styles.small}>{t('additionalTask.explainer')}</Text>}
        <Text style={styles.small}>{t(`requestStatus.${request.status}` as Key)}</Text>
        {open && <Text style={styles.small}>{t('booking.answerBy', { date: formatWhen(request.answerBy) })}</Text>}
      </Card>
      <OpenChat find={async () => request.threadId ?? null} />
      <SectionTitle text={t('booking.quotes')} />
      {quotes.length === 0 && <Text style={styles.small}>{t('booking.noQuotes')}</Text>}
      {quotes.map((q) => (
        <QuoteCard key={q.id} quote={q} onConfirm={isCustomer ? () => confirm(q.id) : undefined} busy={accepting.busy} />
      ))}
      {isCustomer && quoted && <Info text={t('booking.discussChanges')} />}
      <ErrorText text={accepting.problem} />
      <ErrorText text={closing.problem} />
      {open && !askChat && <Button label={t(isCustomer ? 'request.withdraw' : 'request.decline')} onPress={close} busy={closing.busy} danger />}
      {open && askChat && (
        <Card>
          <Text style={styles.text}>{t('booking.talkFirst')}</Text>
          {!!request.threadId && <OpenChat find={async () => request.threadId ?? null} />}
          <Button label={t('booking.declineAnyway')} onPress={() => closing.submit(() => withdrawRequest(request.id), retry)} busy={closing.busy} danger />
          <LinkText label={t('common.cancel')} onPress={() => setAskChat(false)} />
        </Card>
      )}
      {!isCustomer && open && <SendQuoteForm request={request} onSent={retry} />}
    </FormScreen>
  )
}

const styles = StyleSheet.create({
  text: { fontSize: 16, color: '#14352E' },
  small: { fontSize: 14, color: '#5C7A72' },
})
