import { StyleSheet, Text, View } from 'react-native'

import type { Card } from '@kando/contract'

import { t } from '@/i18n'
import { formatAmount } from '@/lib/format'
import { color } from '@/theme'

/** What the server recorded in the thread (a quote, its acceptance, an additional task): amounts and ids only, never text from a person. */
export function CardBubble({ card }: { card: Card }) {
  const amount = card.amount === undefined || !card.currency ? '' : formatAmount(card.amount, card.currency)
  const text =
    card.type === 'quote'
      ? t('chat.card.quote', { amount, version: card.version })
      : card.type === 'acceptance'
        ? t('chat.card.acceptance', { amount })
        : amount
          ? t('chat.card.additionalTask', { amount })
          : t('chat.card.additionalTaskRequested')
  return (
    <View style={styles.card}>
      <Text style={styles.text}>{text}</Text>
      {card.type === 'additional-task' && <Text style={styles.note}>{t('additionalTask.explainer')}</Text>}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { alignSelf: 'center', backgroundColor: color.divider, borderRadius: 6, padding: 12, marginVertical: 6, maxWidth: '90%' },
  text: { fontSize: 15, fontWeight: '700', color: color.ink, textAlign: 'center' },
  note: { fontSize: 13, color: color.ink, textAlign: 'center', marginTop: 4 },
})
