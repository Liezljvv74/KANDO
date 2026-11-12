import type { OwnService } from '@kando/contract'

import { listEntries, replaceServiceRef, type PendingEntry } from '@/lib/pending-saves'

type Api = {
  list: () => Promise<OwnService[]>
  create: (body: object) => Promise<OwnService>
  update: (id: string, body: object) => Promise<OwnService>
  remove: (id: string) => Promise<unknown>
}
type Body = { categoryId: string; known?: string[]; tried?: string[] }

const APP_START = Date.now()
const created = new Map<string, OwnService>()
const sent = new Set<string>()

/** The service created for a temporary id, once the server has it. */
export const createdService = (tmpRef: string) => created.get(tmpRef)

/** The body of a create entry that replaces `prev`: the earlier category is kept in `tried`, its POST may have gone through. */
export function createBody(prev: Pick<PendingEntry, 'body'> | undefined, categoryId: string, known: string[]): Body {
  const p = prev?.body as Body | undefined
  return { categoryId, known, tried: p ? [...(p.tried ?? []), p.categoryId] : [] }
}

/** The category change of an existing service: a 'service-field' entry like the other fields, so it is kept and retried. */
export const categoryEntry = (serviceId: string, accountId: string, categoryId: string) => ({
  key: `service:${serviceId}:category`,
  kind: 'service-field' as const,
  accountId,
  body: { categoryId },
  serviceRef: serviceId,
  route: `/my-profile/service/${serviceId}`,
  field: 'category',
})

/** A refused create of this account: a new-service screen opens on it, so the person can choose another category. */
export const refusedCreate = (accountId: string) => listEntries(accountId).find((e) => e.kind === 'service-create' && e.state === 'refused' && !!e.serviceRef?.startsWith('tmp:'))

/**
 * Sends a 'service-create' entry (body `{ categoryId, known, tried }`, `known` = the service ids the phone had when the
 * category was chosen). When the create may have gone through before (a retry, an earlier category, an entry from before
 * a restart) it first takes over a service of one of those categories it does not know instead of creating a second one.
 * Success renames `tmp:<n>` to the real id in every pending entry. An entry already renamed is a category update.
 */
export function serviceCreateSender(api: Api) {
  return async (e: PendingEntry) => {
    const { categoryId, known = [], tried = [] } = e.body as Body
    const ref = e.serviceRef!
    if (!ref.startsWith('tmp:')) return void (await api.update(ref, { categoryId }))
    let s: OwnService | undefined
    if (e.attempts > 0 || sent.has(ref) || e.createdAt < APP_START || tried.length > 0) {
      const mine = new Set([...known, ...[...created.values()].map((c) => c.id)])
      const ours = (await api.list()).filter((x) => !mine.has(x.id))
      s = ours.find((x) => x.category === categoryId) ?? ours.find((x) => tried.includes(x.category))
      if (s && s.category !== categoryId) s = await api.update(s.id, { categoryId })
    }
    sent.add(ref)
    s ??= await api.create({ categoryId })
    if (!listEntries(e.accountId).some((x) => x.key === e.key)) return void (await api.remove(s.id)) // deleted on the phone meanwhile
    created.set(ref, s)
    replaceServiceRef(ref, s.id)
  }
}
