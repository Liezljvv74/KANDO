import { StyleSheet, Text } from 'react-native'

import type { Quote } from '@kando/contract'

import { Button } from '@/components/auth-ui'
import { Card } from '@/components/form-ui'
import { t, type Key } from '@/i18n'
import { formatWhen } from '@/lib/booking-time'
import { formatPrice } from '@/lib/format'

/** One quote: amount, scope and the day it expires. `onAccept` only for the customer, on a quote that is still open. */
export function QuoteCard({ quote, onAccept, busy }: { quote: Quote; onAccept?: () => void; busy?: boolean }) {
  return (
    <Card>
      <Text style={styles.amount}>{formatPrice({ priceType: 'fixed', price: quote.amount, currency: quote.currency })}</Text>
      <Text style={styles.text}>{quote.scope}</Text>
      {quote.startAt && <Text style={styles.small}>{t('booking.quoteSuggested', { when: formatWhen(quote.startAt) })}</Text>}
      <Text style={styles.small}>{`${t(`quoteStatus.${quote.status}` as Key)} · ${t('booking.quoteValidUntil', { date: formatWhen(quote.expiresAt) })}`}</Text>
      {onAccept && quote.status === 'sent' && <Button label={t('booking.acceptQuote')} onPress={onAccept} busy={busy} />}
    </Card>
  )
}

const styles = StyleSheet.create({
  amount: { fontSize: 20, fontWeight: '700', color: '#0E8A6B' },
  text: { fontSize: 16, color: '#14352E' },
  small: { fontSize: 14, color: '#5C7A72' },
})
