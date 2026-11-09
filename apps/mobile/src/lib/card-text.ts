import type { Card } from '@kando/contract'

import { t } from '@/i18n'
import { formatAmount } from '@/lib/format'

/** The line of a thread card. Without a known amount (no amount, or no currency to show it in) the line is written without it, never with a blank. */
export function cardText(card: Card): string {
  const amount = card.amount === undefined || !card.currency ? undefined : formatAmount(card.amount, card.currency)
  if (card.type === 'quote') return amount ? t('chat.card.quote', { amount, version: card.version }) : t('chat.card.quoteBare', { version: card.version })
  if (card.type === 'acceptance') return amount ? t('chat.card.acceptance', { amount }) : t('chat.card.acceptanceBare')
  return amount ? t('chat.card.additionalTask', { amount }) : t('chat.card.additionalTaskRequested')
}
