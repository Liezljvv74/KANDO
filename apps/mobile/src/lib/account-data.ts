import { errorText, t } from '@/i18n'

/** The delete button is enabled only when the typed text is the account's own email (case and surrounding spaces do not matter). */
export const emailMatches = (typed: string, email: string) => !!email.trim() && typed.trim().toLowerCase() === email.trim().toLowerCase()

/** The export document as the text the share sheet carries. */
export const exportText = (data: unknown) => JSON.stringify(data, null, 2)

/** What the person sees when deleting or exporting fails: the two known refusals, else "nothing was deleted/exported, try again". */
export const accountError = (action: 'delete' | 'export', code: string) =>
  action === 'delete' && (code === 'EMAIL_MISMATCH' || code === 'LAST_ADMIN') ? errorText(code) : t(action === 'delete' ? 'account.deleteFailed' : 'account.exportFailed')
