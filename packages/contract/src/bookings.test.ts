import { describe, expect, it } from 'vitest'

import { AcceptQuoteInputSchema, BookingAnswerSchema, DirectBookingInputSchema, TimeProposalSchema } from './index'

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
