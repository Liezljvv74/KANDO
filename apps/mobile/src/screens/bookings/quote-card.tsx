import { StyleSheet, Text } from 'react-native'

import type { Quote } from '@kando/contract'

import { Button } from '@/components/auth-ui'
import { Card } from '@/components/form-ui'
import { t, type Key } from '@/i18n'
import { formatWhen } from '@/lib/booking-time'
import { formatPrice } from '@/lib/format'
import { font } from '@/theme'

/** One quote: amount, scope, the time (or that it is still to be confirmed) and the day it expires. `onConfirm` only for the customer, on a quote that is still open. */
export function QuoteCard({ quote, onConfirm, busy }: { quote: Quote; onConfirm?: () => void; busy?: boolean }) {
  return (
    <Card list>
      <Text style={styles.amount}>{formatPrice({ priceType: 'fixed', price: quote.amount, currency: quote.currency })}</Text>
      <Text style={styles.text}>{quote.scope}</Text>
      <Text style={styles.small}>{quote.startAt ? t('booking.quoteSuggested', { when: formatWhen(quote.startAt) }) : t('booking.quoteTimeOpen')}</Text>
      <Text style={styles.small}>{`${t(`quoteStatus.${quote.status}` as Key)} · ${t('booking.quoteValidUntil', { date: formatWhen(quote.expiresAt) })}`}</Text>
      {onConfirm && quote.status === 'sent' && <Button label={t('booking.confirmQuote')} onPress={onConfirm} busy={busy} />}
    </Card>
  )
}

const styles = StyleSheet.create({
  amount: { fontSize: 20, fontFamily: font.tag, color: '#34328A' },
  text: { fontSize: 16, color: '#1D1C4A' },
  small: { fontSize: 14, color: '#4F4E7D' },
})
