import type { BlockedUser, Message, Page, Thread } from '@kando/contract'

import { api, upload, type PickedFile } from '@/api/client'

const BASE = '/app-api/v1'

export const listThreads = (cursor?: string) => api<Page<Thread>>(`${BASE}/threads${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`)
export const getThread = (id: string) => api<Thread>(`${BASE}/threads/${encodeURIComponent(id)}`)
/** `after`: the opaque cursor of the last message already shown. */
export const listMessages = async (threadId: string, after?: string) =>
  (await api<{ docs: Message[] }>(`${BASE}/threads/${threadId}/messages${after ? `?after=${encodeURIComponent(after)}` : ''}`)).docs
export const sendMessage = (threadId: string, body: string) => api<Message>(`${BASE}/threads/${threadId}/messages`, { method: 'POST', body: { body } })
export const sendPhoto = (threadId: string, file: PickedFile) => upload<Message>(`${BASE}/threads/${threadId}/photos`, file, {})
export const reportMessage = (id: string, reason: string) => api<null>(`${BASE}/messages/${id}/report`, { method: 'POST', body: { reason } })
export const listBlocks = async () => (await api<{ docs: BlockedUser[] }>(`${BASE}/blocks`)).docs
export const blockUser = (threadId: string) => api<null>(`${BASE}/blocks`, { method: 'POST', body: { threadId } })
export const unblockUser = (threadId: string) => api<null>(`${BASE}/blocks?threadId=${encodeURIComponent(threadId)}`, { method: 'DELETE' })

