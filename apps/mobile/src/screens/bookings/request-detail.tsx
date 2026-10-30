import { useLocalSearchParams } from 'expo-router'
import { useCallback } from 'react'
import { StyleSheet, Text } from 'react-native'

import { acceptQuote, declineRequest, getRequest, listQuotes, withdrawRequest } from '@/api/bookings'
import { Button, ErrorText } from '@/components/auth-ui'
import { Card, FormScreen, SectionTitle } from '@/components/form-ui'
import { ErrorRetry, Loading } from '@/components/state-view'
import { useLoad } from '@/hooks/use-load'
import { useMe } from '@/hooks/use-me'
import { useSubmit } from '@/hooks/use-submit'
import { t, useLang, type Key } from '@/i18n'
import { formatDay, formatWhen } from '@/lib/booking-time'
import { confirmDanger } from '@/lib/confirm'
import { go, goReplace } from '@/lib/go'
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
  // An additional task takes the time and place of its booking: accepting its quote needs no time, it goes straight to paying.
  const extra = !!request.parentBookingId
  const accept = (quoteId: string, expiresAt: string) =>
    extra
      ? accepting.submit(async () => goReplace(`/bookings/${(await acceptQuote(quoteId, {})).id}`))
      : go('/bookings/accept', { quoteId, expiresAt })
  const close = async () => {
    const [ask, yes, call] = isCustomer ? (['request.withdrawConfirm', 'request.withdraw', withdrawRequest] as const) : (['request.declineConfirm', 'request.decline', declineRequest] as const)
    if (await confirmDanger(t(ask), t(yes))) closing.submit(() => call(request.id), retry)
  }
  return (
    <FormScreen title={title}>
      <Card>
        {extra && <Text style={styles.small}>{t('booking.additionalTaskRequest')}</Text>}
        <Text style={styles.text}>{request.description}</Text>
        {extra && <Text style={styles.small}>{t('additionalTask.explainer')}</Text>}
        {request.preferredDate && <Text style={styles.small}>{formatDay(request.preferredDate)}</Text>}
        <Text style={styles.small}>{t(`requestStatus.${request.status}` as Key)}</Text>
        {open && <Text style={styles.small}>{t('booking.answerBy', { date: formatWhen(request.answerBy) })}</Text>}
      </Card>
      <OpenChat find={async () => request.threadId ?? null} />
      <SectionTitle text={t('booking.quotes')} />
      {quotes.length === 0 && <Text style={styles.small}>{t('booking.noQuotes')}</Text>}
      {quotes.map((q) => (
        <QuoteCard key={q.id} quote={q} onAccept={isCustomer ? () => accept(q.id, q.expiresAt) : undefined} busy={accepting.busy} />
      ))}
      <ErrorText text={accepting.problem} />
      <ErrorText text={closing.problem} />
      {open && <Button label={t(isCustomer ? 'request.withdraw' : 'request.decline')} onPress={close} busy={closing.busy} danger />}
      {!isCustomer && open && <SendQuoteForm requestId={request.id} onSent={retry} />}
    </FormScreen>
  )
}

const styles = StyleSheet.create({
  text: { fontSize: 16, color: '#14352E' },
  small: { fontSize: 14, color: '#5C7A72' },
})
