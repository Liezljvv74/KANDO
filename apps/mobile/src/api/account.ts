import { api } from '@/api/client'

/** The person's own data as the server's one JSON document. */
export const getExport = () => api<unknown>('/app-api/v1/me/export')

/** Deletes the account for good; the server checks the email again (400 EMAIL_MISMATCH, 409 LAST_ADMIN). */
export const deleteAccount = (confirmEmail: string) => api<{ ok: true }>('/app-api/v1/me', { method: 'DELETE', body: { confirmEmail } })
