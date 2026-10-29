import { useLocalSearchParams } from 'expo-router'
import { useCallback } from 'react'
import { StyleSheet, Text } from 'react-native'

import { getRequest, listQuotes } from '@/api/bookings'
import { threadIdForRequest } from '@/api/chat'
import { Card, FormScreen, SectionTitle } from '@/components/form-ui'
import { ErrorRetry, Loading } from '@/components/state-view'
import { useLoad } from '@/hooks/use-load'
import { useMe } from '@/hooks/use-me'
import { t, useLang, type Key } from '@/i18n'
import { formatDay, formatWhen } from '@/lib/booking-time'
import { go } from '@/lib/go'
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
  return (
    <FormScreen title={title}>
      <Card>
        <Text style={styles.text}>{request.description}</Text>
        {request.preferredDate && <Text style={styles.small}>{formatDay(request.preferredDate)}</Text>}
        <Text style={styles.small}>{t(`requestStatus.${request.status}` as Key)}</Text>
        {open && <Text style={styles.small}>{t('booking.answerBy', { date: formatWhen(request.answerBy) })}</Text>}
      </Card>
      <OpenChat find={() => threadIdForRequest(request.id)} />
      <SectionTitle text={t('booking.quotes')} />
      {quotes.length === 0 && <Text style={styles.small}>{t('booking.noQuotes')}</Text>}
      {quotes.map((q) => (
        <QuoteCard key={q.id} quote={q} onAccept={isCustomer ? () => go('/bookings/accept', { quoteId: q.id, expiresAt: q.expiresAt }) : undefined} />
      ))}
      {!isCustomer && open && <SendQuoteForm requestId={request.id} onSent={retry} />}
    </FormScreen>
  )
}

const styles = StyleSheet.create({
  text: { fontSize: 16, color: '#14352E' },
  small: { fontSize: 14, color: '#5C7A72' },
})
