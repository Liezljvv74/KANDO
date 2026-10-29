import { StyleSheet, Text, View } from 'react-native'

import type { Card } from '@kando/contract'

import { t } from '@/i18n'
import { formatPrice } from '@/lib/format'

/** What the server recorded in the thread (a quote, its acceptance, an additional task): amounts and ids only, never text from a person. */
export function CardBubble({ card }: { card: Card }) {
  const amount = formatPrice({ priceType: 'fixed', price: card.amount, currency: card.currency })
  const text =
    card.type === 'quote'
      ? t('chat.card.quote', { amount, version: card.version })
      : card.type === 'acceptance'
        ? t('chat.card.acceptance', { amount })
        : t('chat.card.additionalTask', { amount })
  return (
    <View style={styles.card}>
      <Text style={styles.text}>{text}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  card: { alignSelf: 'center', backgroundColor: '#E1F3EC', borderRadius: 12, padding: 12, marginVertical: 6, maxWidth: '90%' },
  text: { fontSize: 15, fontWeight: '700', color: '#0B6B54', textAlign: 'center' },
})
