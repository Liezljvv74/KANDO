import type { Review, ReviewInput } from '@kando/contract'

import { api } from '@/api/client'

const BASE = '/app-api/v1/reviews'

export const writeReview = (bookingId: string, input: ReviewInput) => api<Review>(BASE, { method: 'POST', body: { bookingId, ...input } })
export const editReview = (id: string, input: ReviewInput) => api<Review>(`${BASE}/${encodeURIComponent(id)}`, { method: 'PATCH', body: input })
/** The reviews I wrote, and those about me once they are shown. */
export const myReviews = async () => (await api<{ docs: Review[] }>(BASE)).docs
