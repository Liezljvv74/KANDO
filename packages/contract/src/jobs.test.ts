import { expect, it } from 'vitest'

import { JobsPageSchema, JobsQuerySchema } from './jobs'

it('the jobs query defaults to the customer and Needs you, trims the search and refuses a bad section, search or cursor', () => {
  expect(JobsQuerySchema.parse({})).toEqual({ role: 'customer', section: 'needs_you' })
  expect(JobsQuerySchema.parse({ role: 'provider', section: 'past', q: '  #1044 ' })).toEqual({ role: 'provider', section: 'past', q: '#1044' })
  expect(JobsQuerySchema.safeParse({ section: 'all' }).success).toBe(false)
  expect(JobsQuerySchema.safeParse({ q: '   ' }).success).toBe(false)
  expect(JobsQuerySchema.safeParse({ q: 'x'.repeat(101) }).success).toBe(false)
  expect(JobsQuerySchema.safeParse({ cursor: "2026-01-01T00:00:00Z|x'; drop" }).success).toBe(false)
})

it('a jobs page parses with and without a next cursor', () => {
  const row = { id: 'r', number: 1044, title: 'Fotos', otherParty: 'Anna K.', date: '2026-11-08T10:00:00.000Z', unread: 1, jobState: { key: 'request_sent', section: 'needs_you', tone: 'warn', buttons: ['send_quote'], countsForMe: true } }
  expect(JobsPageSchema.parse({ items: [row], counts: { needsYou: 1, unread: 1 } }).items[0]!.number).toBe(1044)
  expect(JobsPageSchema.parse({ items: [], next: 'c', counts: { needsYou: 0, unread: 0 } }).next).toBe('c')
  expect(JobsPageSchema.parse({ items: [], counts: { needsYou: 0, unread: 0, past: 12 } }).counts.past).toBe(12)
})
