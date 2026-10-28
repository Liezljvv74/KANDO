import { api } from '@/api/client'

export type ExportFormat = 'json' | 'csv'

/** The person's own data: the server's JSON document as an object, or the CSV as text. */
export const getExport = (format: ExportFormat = 'json') =>
  format === 'csv' ? api<string>('/app-api/v1/me/export?format=csv', { text: true }) : api<unknown>('/app-api/v1/me/export')

/** Deletes the account for good; the server checks the email again (400 EMAIL_MISMATCH, 409 LAST_ADMIN). */
export const deleteAccount = (confirmEmail: string) => api<{ ok: true }>('/app-api/v1/me', { method: 'DELETE', body: { confirmEmail } })
