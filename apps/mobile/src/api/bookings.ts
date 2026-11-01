import type {
  AcceptQuoteInput,
  AgreedTimeInput,
  Booking,
  BookingAnswer,
  BookingRequest,
  BookingView,
  BusyTime,
  DirectBookingInput,
  Dispute,
  FinishInput,
  Page,
  Quote,
  QuoteInput,
  RequestInput,
  StopAmountInput,
} from '@kando/contract'

import { api } from '@/api/client'

const json = (method: string, body?: unknown) => ({ method, body })
const BASE = '/app-api/v1'
export type Role = 'customer' | 'provider'
const list = (path: string, role: Role, cursor?: string) => `${BASE}/${path}?role=${role}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`

export const createRequest = (body: RequestInput) => api<BookingRequest>(`${BASE}/requests`, json('POST', body))
export const listRequests = (role: Role, cursor?: string) => api<Page<BookingRequest>>(list('requests', role, cursor))
export const getRequest = (id: string) => api<BookingRequest>(`${BASE}/requests/${id}`)
export const withdrawRequest = (id: string) => api<BookingRequest>(`${BASE}/requests/${encodeURIComponent(id)}/withdraw`, json('POST'))
export const declineRequest = (id: string) => api<BookingRequest>(`${BASE}/requests/${encodeURIComponent(id)}/decline`, json('POST'))
export const listQuotes = async (requestId: string) => (await api<{ docs: Quote[] }>(`${BASE}/requests/${requestId}/quotes`)).docs
export const sendQuote = (requestId: string, body: QuoteInput) => api<Quote>(`${BASE}/requests/${requestId}/quotes`, json('POST', body))
export const acceptQuote = (quoteId: string, body: AcceptQuoteInput) => api<Booking>(`${BASE}/quotes/${quoteId}/accept`, json('POST', body))
/** The customer confirms the quote as it is (its time, or none yet): the booking waits for payment, or for the agreed time. */
export const confirmQuote = (quoteId: string) => api<Booking>(`${BASE}/quotes/${quoteId}/confirm`, json('POST', {}))
/** An awaiting-time booking: one side enters the date and time, the other confirms it. */
export const enterAgreedTime = (id: string, body: AgreedTimeInput) => api<Booking>(`${BASE}/bookings/${encodeURIComponent(id)}/time`, json('POST', body))
export const confirmAgreedTime = (id: string) => api<Booking>(`${BASE}/bookings/${encodeURIComponent(id)}/time/confirm`, json('POST'))
export const createDirectBooking = (body: DirectBookingInput) => api<Booking>(`${BASE}/bookings`, json('POST', body))
export const listBookings = (role: Role, cursor?: string) => api<Page<Booking>>(list('bookings', role, cursor))
export const getBooking = (id: string) => api<BookingView>(`${BASE}/bookings/${encodeURIComponent(id)}`)
export const answerBooking = (id: string, answer: BookingAnswer) => api<Booking>(`${BASE}/bookings/${id}/answer`, json('POST', answer))
export const withdrawBooking = (id: string) => api<Booking>(`${BASE}/bookings/${id}/withdraw`, json('POST'))
export const getBusyTimes = async (slug: string, from: Date, to: Date) =>
  (await api<{ docs: BusyTime[] }>(`${BASE}/providers/${encodeURIComponent(slug)}/busy?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`)).docs

// The endings of a paid booking (plan 2d). Each returns the booking as the server now has it.
const bk = (id: string, path = '') => `${BASE}/bookings/${encodeURIComponent(id)}${path}`
/** The route needs a JSON body: `{}` when no material amount is given. */
export const finishJob = (id: string, input: FinishInput) => api<Booking>(bk(id, '/finish'), json('POST', input))
export const confirmJob = (id: string) => api<Booking>(bk(id, '/confirm'), json('POST'))
export const cancelBooking = (id: string) => api<Booking>(bk(id, '/cancel'), json('POST'))
export const reportNoShow = (id: string) => api<Booking>(bk(id, '/no-show'), json('POST'))
export const objectNoShow = (id: string, description: string) => api<Booking>(bk(id, '/no-show/object'), json('POST', { description }))
export const openDispute = (id: string, description: string) => api<Dispute>(bk(id, '/dispute'), json('POST', { description }))
export const getDispute = (id: string) => api<Dispute>(bk(id, '/dispute'))
export const stopJob = (id: string) => api<Booking>(bk(id, '/stop'), json('POST'))
export const stateStopAmount = (id: string, input: StopAmountInput) => api<Booking>(bk(id, '/stop/amount'), json('POST', input))
export const answerStop = (id: string, agree: boolean) => api<Booking>(bk(id, '/stop/answer'), json('POST', { agree }))
export const startAdditionalTask = (id: string, description: string) => api<BookingRequest>(bk(id, '/additional-task'), json('POST', { description }))
