/** The delete button is enabled only when the typed text is the account's own email (case and surrounding spaces do not matter). */
export const emailMatches = (typed: string, email: string) => !!email.trim() && typed.trim().toLowerCase() === email.trim().toLowerCase()

/** The export document as the text the share sheet carries. */
export const exportText = (data: unknown) => JSON.stringify(data, null, 2)
