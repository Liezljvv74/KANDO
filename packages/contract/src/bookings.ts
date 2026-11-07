import { z } from 'zod'

import { AmountSchema, CurrencySchema, requiredText, text } from './common'
import { RatingSchema } from './endings'

// Mirror the status checks in packages/db/src/schema/bookings.ts.
export const REQUEST_STATUSES = ['open', 'quoted', 'booked', 'expired', 'withdrawn', 'declined'] as const
export const QUOTE_STATUSES = ['sent', 'accepted', 'superseded', 'expired', 'declined'] as const
export const BOOKING_STATUSES = ['awaiting-time', 'awaiting-payment', 'confirmed', 'expired', 'declined', 'withdrawn', 'finished', 'completed', 'disputed', 'cancelled', 'stopped', 'refunded'] as const

/** Why a quote-born booking lapsed: its payment time passed, or the time was never agreed. */
export const LAPSE_REASONS = ['payment', 'time'] as const
export type LapseReason = (typeof LAPSE_REASONS)[number]

const IsoSchema = z.string().datetime({ offset: true })
const DurationSchema = z.number().int().min(15).max(720)

/** Where the work happens, when on site: only the postcode is required. */
export const BookingAddressSchema = z.object({
  street: text(120).optional(),
  postcode: requiredText(16),
  city: text(80).optional(),
})

/** A proposed time; whether the provider can work remotely is checked in the domain. The past-time check also lives there. */
const TimeProposalObject = z.object({
  startAt: IsoSchema,
  durationMin: DurationSchema,
  onSite: z.boolean(),
  address: BookingAddressSchema.optional(),
  note: text(1000).optional(),
})
const onSiteNeedsAddress = (v: { onSite?: boolean; address?: unknown }) => !v.onSite || v.address !== undefined
export const TimeProposalSchema = TimeProposalObject.refine(onSiteNeedsAddress, { message: 'Address required when on site', path: ['address'] })

/**
 * POST /requests: the customer describes the job and proposes the time. The time (start, duration, place) is all or nothing;
 * the server requires it for a new request (packages/domain bookings/requests.ts), so an app from before this change gets a
 * plain error, not a half-saved request.
 */
export const RequestInputSchema = z
  .object({
    providerId: z.string().uuid(),
    serviceId: z.string().uuid().optional(),
    description: requiredText(2000),
    ...TimeProposalObject.partial().shape,
  })
  .refine((v) => (v.startAt === undefined) === (v.durationMin === undefined) && (v.startAt === undefined) === (v.onSite === undefined), { message: 'Start, duration and place go together', path: ['startAt'] })
  .refine(onSiteNeedsAddress, { message: 'Address required when on site', path: ['address'] })

export const RequestSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  providerId: z.string(),
  serviceId: z.string().nullable(),
  description: z.string(),
  /** The customer's proposed time and place; null on an additional-task request (it belongs to a booking that has its own time and place). */
  startAt: z.string().nullable(),
  durationMin: z.number().int().nullable(),
  onSite: z.boolean().nullable(),
  address: BookingAddressSchema.nullable(),
  note: z.string().nullable(),
  /** How many times the customer changed the time after sending. */
  revision: z.number().int(),
  /** Set for an additional task: the booking it adds work to. */
  parentBookingId: z.string().nullable(),
  status: z.enum(REQUEST_STATUSES),
  answerBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** The job's number and title (the provider's service title, else the category name): always sent, optional so an older server still parses. */
  jobNumber: z.number().int().optional(),
  title: z.string().optional(),
  /**
   * Set (customer's own request and the provider's view alike) while the job reads open again because its booking lapsed and the quote
   * it came from can still be booked: the app then asks "Do you still want it?". Null otherwise.
   */
  lapsed: z.enum(LAPSE_REASONS).nullable(),
  /** On the provider's view only: what providers' visible reviews say about this customer (null: none yet). */
  customerRating: RatingSchema.nullish(),
  /** On GET /requests/:id only: the request's chat (an additional task's is its booking's). */
  threadId: z.string().nullish(),
})
export type BookingRequest = z.infer<typeof RequestSchema>
export type RequestInput = z.infer<typeof RequestInputSchema>

/** A quote's start and duration are only a suggestion; the customer confirms the time when accepting. */
export const QuoteInputSchema = z
  .object({
    amount: AmountSchema.refine((v) => v > 0, { message: 'A quote needs a price above zero' }),
    scope: requiredText(2000),
    startAt: IsoSchema.optional(),
    durationMin: DurationSchema.optional(),
  })
  .refine((v) => (v.startAt === undefined) === (v.durationMin === undefined), { message: 'Start and duration go together', path: ['startAt'] })

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

export type TimeProposal = z.infer<typeof TimeProposalSchema>

/** POST /quotes/[id]/confirm: the customer confirms the quote as it is (its time, or none yet): only an optional note. */
export const ConfirmQuoteInputSchema = z.object({ note: text(1000).optional() }).strict()
export type ConfirmQuoteInput = z.infer<typeof ConfirmQuoteInputSchema>

/** POST /bookings/[id]/time and /time/confirm: the date and time entered after a quote was accepted without one. */
export const AgreedTimeInputSchema = z.object({ startAt: IsoSchema, durationMin: DurationSchema, onSite: z.boolean() })
export type AgreedTimeInput = z.infer<typeof AgreedTimeInputSchema>

/**
 * POST /quotes/[id]/accept: an additional task's quote only (an empty body, or a note): it gets the time, duration, place and
 * address of the booking it adds to. An ordinary quote is confirmed with /confirm.
 */
export const AcceptQuoteInputSchema = z.object({ note: text(1000).optional() }).strict()
export type AcceptQuoteInput = z.infer<typeof AcceptQuoteInputSchema>

/** One row of "Quotes sent" (role provider) or "My received quotes" (role customer): the numbered quote document. */
export const QuoteListItemSchema = z.object({
  /** The quote document (use it for the PDF link). */
  id: z.string(),
  /** The quote itself (to open it, confirm it). */
  quoteId: z.string(),
  /** `Q-XXXXXXXX-2026-0001`; a revision adds `_Rev.1`, `_Rev.2`, ... */
  number: z.string(),
  role: z.enum(['customer', 'provider']),
  requestId: z.string(),
  /** Null: the quote says "date and time to be confirmed". */
  startAt: z.string().nullable(),
  durationMin: z.number().int().nullable(),
  amount: AmountSchema,
  currency: CurrencySchema,
  counterparty: z.string(),
  /** The job's service title (null when the request named none or the service is gone). */
  service: z.string().nullable(),
  scope: z.string(),
  /** The quote's last valid day. */
  expiresAt: z.string(),
  status: z.enum(QUOTE_STATUSES),
  issuedAt: z.string(),
  pdfReady: z.boolean(),
  /** Accepted quotes only: the booking made from it and when it was made (its creation; not the start of its payment window); null for any other quote, and for one whose booking has lapsed. */
  bookingId: z.string().nullable(),
  bookedAt: z.string().nullable(),
  /** Set while the quote reads open again because its booking lapsed (payment time passed, or the time was never agreed) and the quote is still valid: the customer is asked if they still want it. Null otherwise. */
  lapsed: z.enum(LAPSE_REASONS).nullable(),
})
export type QuoteListItem = z.infer<typeof QuoteListItemSchema>
export const QuoteListSchema = z.object({ docs: z.array(QuoteListItemSchema) })
export const QuotePdfSchema = z.object({ url: z.string() })

/** A date and time one side entered for an awaiting-time booking, for the other side to confirm (until answerBy). */
export const PendingTimeSchema = z.object({
  by: z.enum(['customer', 'provider']),
  startAt: IsoSchema,
  durationMin: z.number().int(),
  onSite: z.boolean(),
  answerBy: IsoSchema,
})
export type PendingTime = z.infer<typeof PendingTimeSchema>

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
  /** awaiting-time only: the time entered and not yet confirmed (null or absent when none, or when it lapsed). */
  pendingTime: PendingTimeSchema.nullable().optional(),
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
  /** A stopped job: when and by which side; the amount the provider stated as earned (with an optional note) and when. */
  stoppedAt: z.string().nullable(),
  stoppedBy: z.enum(['customer', 'provider']).nullable(),
  stopAmount: AmountSchema.nullable(),
  stopNote: z.string().nullable(),
  stopStatedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** The job's number and title, and this booking's number (`#1040`, `#1040-2`): always sent, optional so an older server still parses. */
  jobNumber: z.number().int().optional(),
  title: z.string().optional(),
  taskNumber: z.string().optional(),
})
export type Booking = z.infer<typeof BookingSchema>

/** GET /bookings/:id: the booking, which side the caller is on, and its chat (null when none exists yet). */
export const BookingViewSchema = z.object({
  booking: BookingSchema,
  viewer: z.enum(['customer', 'provider']),
  threadId: z.string().nullable(),
  /** The number of the quote document this booking was made from (`Q-...`), so a provider sees exactly which quote was accepted; null when none. */
  quoteNumber: z.string().nullable(),
})
export type BookingView = z.infer<typeof BookingViewSchema>

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
