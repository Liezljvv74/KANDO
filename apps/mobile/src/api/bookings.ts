import type {
  AcceptQuoteInput,
  Booking,
  BookingAnswer,
  BookingRequest,
  BusyTime,
  DirectBookingInput,
  Quote,
  QuoteInput,
  RequestInput,
} from '@kando/contract'

import { api } from '@/api/client'

const json = (method: string, body?: unknown) => ({ method, body })
const BASE = '/app-api/v1'
export type Role = 'customer' | 'provider'

export const createRequest = (body: RequestInput) => api<BookingRequest>(`${BASE}/requests`, json('POST', body))
export const listRequests = async (role: Role) => (await api<{ docs: BookingRequest[] }>(`${BASE}/requests?role=${role}`)).docs
export const getRequest = (id: string) => api<BookingRequest>(`${BASE}/requests/${id}`)
export const listQuotes = async (requestId: string) => (await api<{ docs: Quote[] }>(`${BASE}/requests/${requestId}/quotes`)).docs
export const sendQuote = (requestId: string, body: QuoteInput) => api<Quote>(`${BASE}/requests/${requestId}/quotes`, json('POST', body))
export const acceptQuote = (quoteId: string, body: AcceptQuoteInput) => api<Booking>(`${BASE}/quotes/${quoteId}/accept`, json('POST', body))
export const createDirectBooking = (body: DirectBookingInput) => api<Booking>(`${BASE}/bookings`, json('POST', body))
export const listBookings = async (role: Role) => (await api<{ docs: Booking[] }>(`${BASE}/bookings?role=${role}`)).docs
export const answerBooking = (id: string, answer: BookingAnswer) => api<Booking>(`${BASE}/bookings/${id}/answer`, json('POST', answer))
export const withdrawBooking = (id: string) => api<Booking>(`${BASE}/bookings/${id}/withdraw`, json('POST'))
export const getBusyTimes = async (slug: string, from: Date, to: Date) =>
  (await api<{ docs: BusyTime[] }>(`${BASE}/providers/${encodeURIComponent(slug)}/busy?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`)).docs
