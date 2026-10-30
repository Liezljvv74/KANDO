import { z } from 'zod'

import { AmountSchema, CurrencySchema, requiredText, text } from './common'

// Mirror the status checks in packages/db/src/schema/bookings.ts.
export const REQUEST_STATUSES = ['open', 'quoted', 'booked', 'expired', 'withdrawn'] as const
export const QUOTE_STATUSES = ['sent', 'accepted', 'superseded', 'expired', 'declined'] as const
export const BOOKING_STATUSES = ['proposed', 'awaiting-payment', 'confirmed', 'expired', 'declined', 'withdrawn', 'finished', 'completed', 'disputed', 'cancelled', 'stopped', 'refunded'] as const

const IsoSchema = z.string().datetime({ offset: true })
const DurationSchema = z.number().int().min(15).max(720)

/** Where the work happens, when on site: only the postcode is required. */
export const BookingAddressSchema = z.object({
  street: text(120).optional(),
  postcode: requiredText(16),
  city: text(80).optional(),
})

/** POST /requests: the customer describes the job. */
export const RequestInputSchema = z.object({
  providerId: z.string().uuid(),
  serviceId: z.string().uuid().optional(),
  description: requiredText(2000),
  preferredDate: z.string().date().optional(),
})

export const RequestSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  providerId: z.string(),
  serviceId: z.string().nullable(),
  description: z.string(),
  preferredDate: z.string().nullable(),
  status: z.enum(REQUEST_STATUSES),
  answerBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type BookingRequest = z.infer<typeof RequestSchema>
export type RequestInput = z.infer<typeof RequestInputSchema>

/** A quote's start and duration are only a suggestion; the customer confirms the time when accepting. */
export const QuoteInputSchema = z.object({
  amount: AmountSchema,
  scope: requiredText(2000),
  startAt: IsoSchema.optional(),
  durationMin: DurationSchema.optional(),
})

export type QuoteInput = z.infer<typeof QuoteInputSchema>

export const QuoteSchema = z.object({
  id: z.string(),
  requestId: z.string(),
  providerId: z.string(),
  version: z.number().int(),
  amount: AmountSchema,
  currency: CurrencySchema,
  scope: z.string(),
  startAt: z.string().nullable(),
  durationMin: z.number().int().nullable(),
  status: z.enum(QUOTE_STATUSES),
  expiresAt: z.string(),
  createdAt: z.string(),
})
export type Quote = z.infer<typeof QuoteSchema>

/** A proposed time; whether the provider can work remotely is checked in the domain. The past-time check also lives there. */
export const TimeProposalSchema = z
  .object({
    startAt: IsoSchema,
    durationMin: DurationSchema,
    onSite: z.boolean(),
    address: BookingAddressSchema.optional(),
    note: text(1000).optional(),
  })
  .refine((v) => !v.onSite || v.address !== undefined, { message: 'Address required when on site', path: ['address'] })
export type TimeProposal = z.infer<typeof TimeProposalSchema>

/** POST /quotes/[id]/accept: the customer's proposed time. */
export const AcceptQuoteInputSchema = TimeProposalSchema
export type AcceptQuoteInput = z.infer<typeof AcceptQuoteInputSchema>

/** POST /bookings: a booking without a prior request. */
export const DirectBookingInputSchema = z.intersection(TimeProposalSchema, z.object({ serviceId: z.string().uuid() }))
export type DirectBookingInput = z.infer<typeof DirectBookingInputSchema>

/** The other party's answer to a proposed booking. */
export const BookingAnswerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('accept') }),
  z.object({ type: z.literal('decline') }),
  z.object({ type: z.literal('counter'), startAt: IsoSchema, durationMin: DurationSchema, onSite: z.boolean() }),
])
export type BookingAnswer = z.infer<typeof BookingAnswerSchema>

export const BookingSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  providerId: z.string(),
  serviceId: z.string().nullable(),
  quoteId: z.string().nullable(),
  /** The request a quote booking came from (its chat is the request's); null for a direct booking. */
  requestId: z.string().nullable(),
  /** An additional task: the booking it adds to; null for an ordinary booking. */
  parentBookingId: z.string().nullable(),
  source: z.enum(['quote', 'direct']),
  status: z.enum(BOOKING_STATUSES),
  startAt: z.string(),
  durationMin: z.number().int(),
  amount: AmountSchema,
  currency: CurrencySchema,
  onSite: z.boolean(),
  address: BookingAddressSchema.nullable(),
  note: z.string().nullable(),
  answerBy: z.string().nullable(),
  payBy: z.string().nullable(),
  counterBy: z.enum(['provider', 'customer']).nullable(),
  /** When the provider tapped "Finished" (or the customer said it was done). */
  finishedAt: z.string().nullable(),
  /** When the payment to the provider is made unless the customer confirms earlier or reports a problem. */
  confirmBy: z.string().nullable(),
  /** When the customer was asked "Was the job done?" (the provider never tapped "Finished"); from then on they can confirm. */
  askedDoneAt: z.string().nullable(),
  /** A cancellation: when, by which side, and whether it came less than 24 hours before the start. */
  cancelledAt: z.string().nullable(),
  cancelledBy: z.enum(['customer', 'provider']).nullable(),
  lateCancel: z.boolean(),
  /** The side reported as not turning up (the booking stays confirmed until the objection window ends or staff decide). */
  noShow: z.enum(['customer', 'provider']).nullable(),
  noShowReportedAt: z.string().nullable(),
  /** Until when the reported side may object (noShowReportedAt + 48 hours). */
  noShowObjectBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type Booking = z.infer<typeof BookingSchema>

/** What others may see of a calendar: the time only. */
export const BusyTimeSchema = z.object({
  startAt: z.string(),
  endAt: z.string(),
  state: z.enum(['pending', 'booked']),
})
export type BusyTime = z.infer<typeof BusyTimeSchema>

export const BUSY_MAX_DAYS = 62
export const BusyQuerySchema = z
  .object({ from: z.coerce.date(), to: z.coerce.date() })
  .refine((q) => q.to > q.from && q.to.getTime() - q.from.getTime() <= BUSY_MAX_DAYS * 86_400_000, { message: `range must be 1 to ${BUSY_MAX_DAYS} days` })
