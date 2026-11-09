import type { Card } from '@kando/contract'

import { cardText } from './card-text'

jest.mock('@/i18n', () => ({ t: (key: string, p?: Record<string, string | number>) => jest.requireActual('@kando/i18n/app').t('en', key, p) }))
jest.mock('@/lib/format', () => ({ formatAmount: (n: number, c: string) => `${c} ${n}` }))

const card = (c: object) => c as Card

test('a card with its amount and currency shows the amount in that currency', () => {
  expect(cardText(card({ type: 'quote', refId: 'q', amount: 80, currency: 'ZAR', version: 2 }))).toBe('Quote: ZAR 80 (version 2)')
  expect(cardText(card({ type: 'additional-task', refId: 'q', amount: 40, currency: 'EUR' }))).toBe('Additional task: EUR 40')
})

test('an amount without a currency is left out of the line, with no blank or dangling colon', () => {
  expect(cardText(card({ type: 'quote', refId: 'q', amount: 80, version: 2 }))).toBe('Quote (version 2)')
  expect(cardText(card({ type: 'acceptance', refId: 'q', amount: 80 }))).toBe('Quote accepted')
  expect(cardText(card({ type: 'additional-task', refId: 'q', amount: 40 }))).toBe('Additional task requested')
})
