// PLACEHOLDER: the legal entity does not exist yet (foundation design section 9); README launch item
export const PLATFORM_ENTITY = {
  name: '[LEGAL NAME]',
  address: '[ADDRESS]',
  register: '[REGISTER ENTRY]',
  vatId: '[VAT ID]',
  vatNote: '[VAT WORDING: TAX ADVISER]',
}

/** PLATFORM_ENTITY still holds a bracketed placeholder (the legal entity's details are not filled in yet). */
export const entityHasPlaceholders = (entity: Record<string, string> = PLATFORM_ENTITY): boolean => Object.values(entity).some((v) => /\[[^\]]*\]/.test(v))

/**
 * Documents the platform issues (provider invoices on their behalf, commission invoices) are TEST documents while payments
 * are not live. Once live, they may only be issued when the legal entity's details are real: with a placeholder left,
 * nothing is issued (no number used, logged, retried by the next run), never a real-looking invoice from "[LEGAL NAME]".
 */
export const platformDocumentsBlocked = (live: boolean, entity: Record<string, string> = PLATFORM_ENTITY): boolean => live && entityHasPlaceholders(entity)
