import type { BlockedUser, Booking, Message, Thread } from '@kando/contract'

import { listQuotes, listRequests, type Role } from '@/api/bookings'
import { api, upload, type PickedFile } from '@/api/client'

const BASE = '/app-api/v1'

export const listThreads = async () => (await api<{ docs: Thread[] }>(`${BASE}/threads`)).docs
/** `after`: the opaque cursor of the last message already shown. */
export const listMessages = async (threadId: string, after?: string) =>
  (await api<{ docs: Message[] }>(`${BASE}/threads/${threadId}/messages${after ? `?after=${encodeURIComponent(after)}` : ''}`)).docs
export const sendMessage = (threadId: string, body: string) => api<Message>(`${BASE}/threads/${threadId}/messages`, { method: 'POST', body: { body } })
export const sendPhoto = (threadId: string, file: PickedFile) => upload<Message>(`${BASE}/threads/${threadId}/photos`, file, {})
export const reportMessage = (id: string, reason: string) => api<null>(`${BASE}/messages/${id}/report`, { method: 'POST', body: { reason } })
export const listBlocks = async () => (await api<{ docs: BlockedUser[] }>(`${BASE}/blocks`)).docs
export const blockUser = (userId: string) => api<null>(`${BASE}/blocks`, { method: 'POST', body: { userId } })
export const unblockUser = (userId: string) => api<null>(`${BASE}/blocks/${encodeURIComponent(userId)}`, { method: 'DELETE' })

/** The chat of a request (opened with the request), or null. */
export const threadIdForRequest = async (requestId: string) => (await listThreads()).find((t) => t.requestId === requestId)?.id ?? null

/**
 * The chat of a booking: a direct booking has its own, a booking from a quote shares its request's. There is no read-one route
 * for either, so the request is found among the person's requests to the same other side by the quote it holds.
 */
export async function threadIdForBooking(b: Pick<Booking, 'id' | 'quoteId' | 'customerId' | 'providerId'>, role: Role): Promise<string | null> {
  const threads = await listThreads()
  const own = threads.find((t) => t.bookingId === b.id)
  if (own || !b.quoteId) return own?.id ?? null
  for (const r of (await listRequests(role)).filter((r) => r.customerId === b.customerId && r.providerId === b.providerId)) {
    if ((await listQuotes(r.id)).some((q) => q.id === b.quoteId)) return threads.find((t) => t.requestId === r.id)?.id ?? null
  }
  return null
}
