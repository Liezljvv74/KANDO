import { describe, expect, it } from 'vitest'

import { AcceptQuoteInputSchema, AgreedTimeInputSchema, BOOKING_STATUSES, BookingAnswerSchema, BookingSchema, ConfirmQuoteInputSchema, DirectBookingInputSchema, PendingTimeSchema, QuoteListItemSchema, RequestInputSchema, TimeProposalSchema } from './index'

const proposal = { startAt: '2026-11-05T09:00:00.000Z', durationMin: 60, onSite: false }

describe('TimeProposalSchema', () => {
  it('rejects a start that is not an ISO datetime', () => {
    expect(TimeProposalSchema.safeParse(proposal).success).toBe(true)
    expect(TimeProposalSchema.safeParse({ ...proposal, startAt: 'tomorrow' }).success).toBe(false)
    expect(TimeProposalSchema.safeParse({ ...proposal, startAt: '2026-11-05' }).success).toBe(false)
  })

  it('rejects duration 0 and 721', () => {
    expect(TimeProposalSchema.safeParse({ ...proposal, durationMin: 0 }).success).toBe(false)
    expect(TimeProposalSchema.safeParse({ ...proposal, durationMin: 721 }).success).toBe(false)
    expect(TimeProposalSchema.safeParse({ ...proposal, durationMin: 15 }).success).toBe(true)
    expect(TimeProposalSchema.safeParse({ ...proposal, durationMin: 720 }).success).toBe(true)
  })

  it('accepts address with postcode only', () => {
    expect(TimeProposalSchema.safeParse({ ...proposal, onSite: true, address: { postcode: '10115' } }).success).toBe(true)
    expect(TimeProposalSchema.safeParse({ ...proposal, onSite: true, address: { street: 'A 1' } }).success).toBe(false)
  })

  it('an on-site proposal without an address is rejected and a remote one without an address is accepted', () => {
    expect(TimeProposalSchema.safeParse({ ...proposal, onSite: true }).success).toBe(false)
    expect(AcceptQuoteInputSchema.safeParse({ ...proposal, onSite: true }).success).toBe(false)
    expect(TimeProposalSchema.safeParse({ ...proposal, onSite: false }).success).toBe(true)
  })

  it('a direct booking also needs a service', () => {
    const serviceId = '3f1c2a52-6a40-4a2c-9f44-6d1f5a8c9b11'
    expect(DirectBookingInputSchema.safeParse({ ...proposal, serviceId }).success).toBe(true)
    expect(DirectBookingInputSchema.safeParse(proposal).success).toBe(false)
    expect(DirectBookingInputSchema.safeParse({ ...proposal, onSite: true, serviceId }).success).toBe(false)
  })
})

describe('BookingAnswerSchema', () => {
  it('parses counter and rejects a counter without startAt', () => {
    const counter = { type: 'counter', startAt: proposal.startAt, durationMin: 90, onSite: true }
    expect(BookingAnswerSchema.safeParse(counter).success).toBe(true)
    expect(BookingAnswerSchema.safeParse({ type: 'counter', durationMin: 90, onSite: true }).success).toBe(false)
    expect(BookingAnswerSchema.safeParse({ type: 'accept' }).success).toBe(true)
    expect(BookingAnswerSchema.safeParse({ type: 'decline' }).success).toBe(true)
    expect(BookingAnswerSchema.safeParse({ type: 'other' }).success).toBe(false)
  })
})

describe('BookingSchema', () => {
  it('carries the request id (null for a direct booking) and never the payment internals', () => {
    const keys = Object.keys(BookingSchema.shape)
    expect(keys).toContain('requestId')
    expect(BookingSchema.shape.requestId.safeParse(null).success).toBe(true)
    for (const k of ['commissionRate', 'paymentRef', 'checkoutRef', 'paidAt', 'releasedAt', 'acceptedAt']) expect(keys).not.toContain(k)
  })
})

describe('flow 1: a request carries the customer\'s time', () => {
  const base = { providerId: '3f1c2a52-6a40-4a2c-9f44-6d1f5a8c9b11', description: 'Fix the fence' }

  it('a request with a complete time is accepted; on site needs an address', () => {
    expect(RequestInputSchema.safeParse({ ...base, ...proposal }).success).toBe(true)
    expect(RequestInputSchema.safeParse({ ...base, ...proposal, onSite: true }).success).toBe(false)
    expect(RequestInputSchema.safeParse({ ...base, ...proposal, onSite: true, address: { postcode: '04109' }, note: 'Back door' }).success).toBe(true)
  })

  it('a half-given time is rejected (all of start, duration and place, or none)', () => {
    expect(RequestInputSchema.safeParse({ ...base, startAt: proposal.startAt }).success).toBe(false)
    expect(RequestInputSchema.safeParse({ ...base, startAt: proposal.startAt, durationMin: 60 }).success).toBe(false)
    expect(RequestInputSchema.safeParse({ ...base, ...proposal, durationMin: 5 }).success).toBe(false)
  })

  it('an old-style request without a time still parses (the server decides whether it is allowed)', () => {
    expect(RequestInputSchema.safeParse(base).success).toBe(true)
  })

  it('confirming a quote takes no time, only an optional note', () => {
    expect(ConfirmQuoteInputSchema.safeParse({}).success).toBe(true)
    expect(ConfirmQuoteInputSchema.safeParse({ note: 'Thank you' }).success).toBe(true)
    expect(ConfirmQuoteInputSchema.safeParse({ ...proposal }).success).toBe(false)
  })

  it('an agreed time (after a quote without a time) is a start, a duration and the place kind', () => {
    expect(AgreedTimeInputSchema.safeParse(proposal).success).toBe(true)
    expect(AgreedTimeInputSchema.safeParse({ startAt: 'soon', durationMin: 60, onSite: false }).success).toBe(false)
    expect(AgreedTimeInputSchema.safeParse({ ...proposal, durationMin: 0 }).success).toBe(false)
  })

  it('a quote list item has a number, a role and a status', () => {
    const item = { id: 'q1', quoteId: 'q1', number: 'Q-ABCD1234-2026-0001_Rev.1', role: 'provider', requestId: 'r1', startAt: null, durationMin: null, amount: 120, currency: 'EUR', counterparty: 'Anna H.', status: 'sent', issuedAt: '2026-11-01T10:00:00.000Z', pdfReady: true }
    expect(QuoteListItemSchema.safeParse(item).success).toBe(true)
    expect(QuoteListItemSchema.safeParse({ ...item, role: 'admin' }).success).toBe(false)
    expect(QuoteListItemSchema.safeParse({ ...item, status: 'weird' }).success).toBe(false)
  })

  it('a pending time has a side, a time and a deadline; a booking may carry none', () => {
    const pending = { by: 'provider', startAt: '2026-11-05T09:00:00.000Z', durationMin: 90, onSite: true, answerBy: '2026-11-03T09:00:00.000Z' }
    expect(PendingTimeSchema.safeParse(pending).success).toBe(true)
    expect(PendingTimeSchema.safeParse({ ...pending, by: 'staff' }).success).toBe(false)
    expect(PendingTimeSchema.safeParse({ ...pending, answerBy: 'soon' }).success).toBe(false)
  })

  it('awaiting-time is a booking status', () => {
    expect(BOOKING_STATUSES).toContain('awaiting-time')
  })
})
