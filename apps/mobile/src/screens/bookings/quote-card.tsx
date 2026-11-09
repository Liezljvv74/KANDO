import { StyleSheet, Text } from 'react-native'

import type { Quote } from '@kando/contract'

import { Button, LinkText } from '@/components/auth-ui'
import { Card } from '@/components/form-ui'
import { t, type Key } from '@/i18n'
import { formatWhen } from '@/lib/booking-time'
import { formatAmount } from '@/lib/format'
import { color, font } from '@/theme'

/** One quote: amount, scope, the time (or that it is still to be confirmed) and the day it expires. `onConfirm` only for the customer, on a quote that is still open; `onPdf` where the quote has a document. */
export function QuoteCard({ quote, onConfirm, busy, onPdf }: { quote: Quote; onConfirm?: () => void; busy?: boolean; onPdf?: () => void }) {
  return (
    <Card list>
      <Text style={styles.amount}>{formatAmount(quote.amount, quote.currency)}</Text>
      <Text style={styles.text}>{quote.scope}</Text>
      <Text style={styles.small}>{quote.startAt ? t('booking.quoteSuggested', { when: formatWhen(quote.startAt) }) : t('booking.quoteTimeOpen')}</Text>
      <Text style={styles.small}>{`${t(`quoteStatus.${quote.status}` as Key)} · ${t('booking.quoteValidUntil', { date: formatWhen(quote.expiresAt) })}`}</Text>
      {onPdf && <LinkText label={t('quote.pdf')} onPress={onPdf} />}
      {onConfirm && quote.status === 'sent' && <Button label={t('booking.confirmQuote')} onPress={onConfirm} busy={busy} />}
    </Card>
  )
}

const styles = StyleSheet.create({
  amount: { fontSize: 20, fontFamily: font.tag, color: color.indigo },
  text: { fontSize: 16, color: color.ink },
  small: { fontSize: 14, color: color.inkMuted },
})
