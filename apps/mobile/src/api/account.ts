import { api, ApiError } from '@/api/client'

export type ExportFormat = 'json' | 'csv'

/** The person's own data: the server's JSON document as an object, or the CSV as text. An empty answer is a failed read, never something to share. */
export async function getExport(format: ExportFormat = 'json') {
  const data = format === 'csv' ? await api<string>('/app-api/v1/me/export?format=csv', { text: true }) : await api<unknown>('/app-api/v1/me/export')
  if (data == null || data === '') throw new ApiError(0, 'network')
  return data
}

/** Deletes the account for good; the server checks the password (403 WRONG_PASSWORD, 503 AUTH_BUSY, 409 LAST_ADMIN). Its own long time limit: the server may still be working. */
export const deleteAccount = (password: string) =>
  api<{ ok: true }>('/app-api/v1/me', { method: 'DELETE', body: { password }, timeLimit: DELETE_TIMEOUT_MS })

export const DELETE_TIMEOUT_MS = 60_000
