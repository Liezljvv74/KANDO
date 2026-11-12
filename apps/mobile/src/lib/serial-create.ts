import type { OwnService } from '@kando/contract'

import { replaceServiceRef, type PendingEntry } from '@/lib/pending-saves'

type Api = { list: () => Promise<OwnService[]>; create: (body: object) => Promise<OwnService>; update: (id: string, body: object) => Promise<OwnService> }

const created = new Map<string, OwnService>()
const sent = new Set<string>()

/** The service created for a temporary id, once the server has it. */
export const createdService = (tmpRef: string) => created.get(tmpRef)

/**
 * Sends a 'service-create' entry (body `{ categoryId, known }`, `known` = the service ids the phone had when the category
 * was chosen). On a resend it first looks for a service of that category it does not know (the earlier create went
 * through but its answer was lost) and takes it over instead of creating a second one. Success renames `tmp:<n>` to the
 * real id in every pending entry. An entry already renamed (a category chosen again during the create) is an update.
 */
export function serviceCreateSender(api: Api) {
  return async (e: PendingEntry) => {
    const { categoryId, known = [] } = e.body as { categoryId: string; known?: string[] }
    const ref = e.serviceRef!
    if (!ref.startsWith('tmp:')) return void (await api.update(ref, { categoryId }))
    let s: OwnService | undefined
    if (e.attempts > 0 || sent.has(ref)) {
      const mine = new Set([...known, ...[...created.values()].map((c) => c.id)])
      s = (await api.list()).find((x) => x.category === categoryId && !mine.has(x.id))
    }
    sent.add(ref)
    s ??= await api.create({ categoryId })
    created.set(ref, s)
    replaceServiceRef(ref, s.id)
  }
}
