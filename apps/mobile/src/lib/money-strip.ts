import type { ProviderMoney } from '@kando/contract'

import { formatAmount } from '@/lib/format'

export const STRIP_KEYS = ['money.strip.received', 'money.strip.onItsWay', 'money.strip.onHold'] as const

/** The three amounts of the money strip, formatted in the provider's currency; null (show nothing) while there is no data or no currency. */
export function stripCells(data: ProviderMoney | null | undefined, format: (amount: number, currency: string) => string = formatAmount) {
  if (!data?.currency) return null
  const { currency } = data
  return [
    [STRIP_KEYS[0], format(data.receivedThisMonth, currency)],
    [STRIP_KEYS[1], format(data.onItsWay, currency)],
    [STRIP_KEYS[2], format(data.onHold, currency)],
  ] as const
}
