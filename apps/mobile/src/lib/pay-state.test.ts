import { CONFIRMING_MS, payCard } from './pay-state'

const now = new Date('2027-01-04T10:00:00Z')
const at = (ms: number) => now.getTime() - ms
const open = { status: 'awaiting-payment', payBy: '2027-01-05T10:00:00Z' } as const

test('confirmed shows Paid for the customer; nothing for the provider', () => {
  expect(payCard({ status: 'confirmed', payBy: null }, 'customer', null, false, now)).toBe('paid')
  expect(payCard({ status: 'confirmed', payBy: null }, 'provider', null, false, now)).toBe('none')
})

test('awaiting payment before payBy: Pay now, or being confirmed after the link was opened', () => {
  expect(payCard(open, 'customer', null, false, now)).toBe('pay')
  expect(payCard(open, 'provider', null, false, now)).toBe('none')
  expect(payCard(open, 'customer', at(60_000), false, now)).toBe('confirming')
})

test('being confirmed ends after 10 minutes or when the user says they did not finish: then Pay again', () => {
  expect(payCard(open, 'customer', at(CONFIRMING_MS - 1), false, now)).toBe('confirming')
  expect(payCard(open, 'customer', at(CONFIRMING_MS), false, now)).toBe('payAgain')
  expect(payCard(open, 'customer', at(1000), true, now)).toBe('payAgain')
})

test('after payBy without confirmation: neither card, an explanation instead', () => {
  const late = { status: 'awaiting-payment', payBy: '2027-01-04T09:00:00Z' } as const
  expect(payCard(late, 'customer', null, false, now)).toBe('expired')
  expect(payCard(late, 'customer', at(1000), false, now)).toBe('expired')
  expect(payCard({ status: 'awaiting-payment', payBy: null }, 'customer', null, false, now)).toBe('expired')
})

test('other statuses show nothing', () => {
  expect(payCard({ status: 'proposed', payBy: null }, 'customer', null, false, now)).toBe('none')
  expect(payCard({ status: 'expired', payBy: null }, 'customer', null, false, now)).toBe('none')
})
