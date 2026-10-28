import type { Missing, OwnService } from '@kando/contract'
import { COMPULSORY } from './compulsory'
import type { DocumentRow } from './documents'

// Whether a card's compulsory information is complete: the card then shows green.

export const servicesComplete = (services: Pick<OwnService, 'priceType'>[]) => services.some((s) => s.priceType != null)

// The About you form's compulsory items are the server's `missing` items that are neither the service nor the account name.
const ABOUT_ITEMS = new Set<Missing>(Object.values(COMPULSORY).map((f) => f.item).filter((i) => i !== 'service'))
export const aboutComplete = (missing: string[]) => !missing.some((m) => ABOUT_ITEMS.has(m as Missing))

const sent = (r: DocumentRow) => r.state === 'approved' || r.state === 'pending'
/** Every compulsory document approved or in review; with none compulsory, at least one document approved or in review. */
export function documentsComplete(rows: DocumentRow[]) {
  const required = rows.filter((r) => !r.optional)
  return required.length ? required.every(sent) : rows.some(sent)
}

/** Past jobs and Portfolio have nothing compulsory: green once they hold an entry. */
export const hasEntries = (n: number) => n > 0
