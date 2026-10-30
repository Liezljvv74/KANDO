import type { PayLink, PayoutStatus } from '@kando/contract'

import { api } from '@/api/client'

const BASE = '/app-api/v1'

/** The Stripe-hosted page where the customer pays the booking. */
export const payBooking = (id: string) => api<PayLink>(`${BASE}/bookings/${encodeURIComponent(id)}/pay`, { method: 'POST' })
/** A fresh Stripe-hosted payout set-up link for the caller's own profile. */
export const startPayoutSetup = () => api<PayLink>(`${BASE}/payouts/setup`, { method: 'POST' })
export const payoutStatus = () => api<PayoutStatus>(`${BASE}/payouts/status`)
/** "Notify me when available" (204) and its undo. */
export const notifyMe = (slug: string) => api<null>(`${BASE}/providers/${encodeURIComponent(slug)}/notify-me`, { method: 'POST' })
export const stopNotifyMe = (slug: string) => api<null>(`${BASE}/providers/${encodeURIComponent(slug)}/notify-me`, { method: 'DELETE' })
