import { ApiError } from '@/api/client'
import { errorText, t } from '@/i18n'

/** The export document as the text the share sheet carries. */
export const exportText = (data: unknown) => (typeof data === 'string' ? data : JSON.stringify(data, null, 2))

/** What the person sees when deleting or exporting fails: the known refusals, else "nothing was deleted/exported, try again". */
export const accountError = (action: 'delete' | 'export', code: string) =>
  action === 'delete' && (code === 'WRONG_PASSWORD' || code === 'AUTH_BUSY' || code === 'LAST_ADMIN') ? errorText(code) : t(action === 'delete' ? 'account.deleteFailed' : 'account.exportFailed')

export type DeleteFailure = { deleted: true } | { deleted: false; text: string }

/**
 * A DELETE that did not answer ok. A refusal (403 WRONG_PASSWORD, 409 LAST_ADMIN, 503 AUTH_BUSY: the password check did not run) means nothing was deleted. No answer (offline, the time limit)
 * or a server error means the server may have committed: ask `check` (a call with the session) and take a 401 as "gone".
 * Anything else there says the deletion is unconfirmed, never "not deleted".
 */
export async function afterDeleteFailure(error: unknown, check: () => Promise<unknown>): Promise<DeleteFailure> {
  const status = error instanceof ApiError ? error.status : 0
  const code = error instanceof ApiError ? error.code : ''
  if (status === 401) return { deleted: true }
  if (status === 503 && code === 'AUTH_BUSY') return { deleted: false, text: accountError('delete', code) }
  if (status >= 400 && status < 500) return { deleted: false, text: accountError('delete', code) }
  try {
    await check()
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return { deleted: true }
  }
  return { deleted: false, text: t('account.deleteUnconfirmed') }
}
