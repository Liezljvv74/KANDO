'use client'

import { formatMoney, LOCALE, type Key, type Lang } from '@kando/i18n'

type At = (key: Key, params?: Record<string, string | number>) => string

/** The booking status in the back office's words (the app's own labels, plus the two before payment). */
export const statusLabel = (at: At, s: string) =>
  s === 'proposed' ? at('admin.bookingStatus.proposed') : s === 'awaiting-payment' ? at('admin.bookingStatus.awaitingPayment') : at(`bookingStatus.${s}` as Key)

export const when = (lang: Lang, v: string | null | undefined) => (v ? new Date(v).toLocaleString(LOCALE[lang]) : '')
export const money = (lang: Lang, amount: number | null | undefined, currency = 'EUR') => (amount === null || amount === undefined ? '' : formatMoney(amount, currency, lang))
