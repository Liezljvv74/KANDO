import { inArray } from 'drizzle-orm'
import { bookings, db, providers, requests, users } from '@kando/db'
import type { NoticeJob } from '@kando/contract'
import { t, type Lang } from '@kando/i18n'
import { publicNameFor } from '../providers/public-name'
import { rootJobs, rootRequestId, rootsOf } from './job-lookup'

type Db = Parameters<typeof rootsOf>[0]
type Ref = { bookingId?: string; requestId?: string }

/** `#1040 Photo session`: the text a notice, push or email names its job by. */
export const jobLabel = (j: Pick<NoticeJob, 'number' | 'title'>): string => `#${j.number} ${j.title}`

/** The push names the job by its number only (a lock screen must not show the title): the one place for that formatting. */
export const pushWithJob = (lang: Lang, job: Pick<NoticeJob, 'number'> | null | undefined, text: string): string => (job ? t(lang, 'notice.withJob', { job: `#${job.number}`, text }) : text)

/**
 * The job (root request), its number and title and the other party for the booking or request each notice refers to, worked out
 * for `userId` only: a ref whose row the person is not a party to (or that no longer exists) gives null, never another person's job.
 * Read when the notice is shown or sent; the stored payload stays ids only. Same index as `refs`.
 */
export async function jobsForNotices(x: Db, userId: string, refs: Ref[]): Promise<(NoticeJob | null)[]> {
  const ok = (id?: string): id is string => !!id && /^[0-9a-f-]{36}$/i.test(id)
  const bookingIds = [...new Set(refs.flatMap((r) => (ok(r.bookingId) ? [r.bookingId] : [])))]
  const requestIds = [...new Set(refs.flatMap((r) => (ok(r.requestId) ? [r.requestId] : [])))]
  const bks = bookingIds.length ? await x.select({ id: bookings.id, requestId: bookings.requestId, customerId: bookings.customerId, providerId: bookings.providerId }).from(bookings).where(inArray(bookings.id, bookingIds)) : []
  const rqIds = [...new Set([...requestIds, ...bks.map((b) => b.requestId)])]
  const rqs = rqIds.length ? await x.select({ id: requests.id, parentBookingId: requests.parentBookingId, customerId: requests.customerId, providerId: requests.providerId }).from(requests).where(inArray(requests.id, rqIds)) : []
  const sides = [...bks, ...rqs]
  const provs = sides.length ? await db.select({ id: providers.id, ownerId: providers.ownerId, publicName: providers.publicName, businessName: providers.businessName, type: providers.type }).from(providers).where(inArray(providers.id, [...new Set(sides.map((s) => s.providerId))])) : []
  const ids = [...new Set([...sides.map((s) => s.customerId), ...provs.map((p) => p.ownerId)])]
  const people = new Map((ids.length ? await db.select({ id: users.id, first: users.firstName, last: users.lastName }).from(users).where(inArray(users.id, ids)) : []).map((u) => [u.id, u]))
  const prov = new Map(provs.map((p) => [p.id, p]))
  const roots = await rootsOf(x, [...bks.map((b) => b.id), ...rqs.flatMap((r) => (r.parentBookingId ? [r.parentBookingId] : []))])
  const rootOfReq = (r: (typeof rqs)[number]) => rootRequestId(r, roots)
  const rootOfBooking = (b: (typeof bks)[number]) => roots.get(b.id)?.requestId ?? null
  const jobs = await rootJobs(x, [...new Set([...bks.flatMap((b) => rootOfBooking(b) ?? []), ...rqs.flatMap((r) => rootOfReq(r) ?? [])])], userId)
  const otherParty = (s: (typeof sides)[number]): string | null => {
    const p = prov.get(s.providerId)
    const owner = p && people.get(p.ownerId)
    if (!p) return null
    if (p.ownerId === userId) {
      const c = people.get(s.customerId)
      return publicNameFor(c?.first ?? null, c?.last ?? null, null, null)
    }
    if (s.customerId !== userId) return null // not a party
    return p.publicName || publicNameFor(owner?.first ?? null, owner?.last ?? null, p.businessName, p.type)
  }
  return refs.map((r) => {
    const b = ok(r.bookingId) ? bks.find((k) => k.id === r.bookingId) : undefined
    const q = !b && ok(r.requestId) ? rqs.find((k) => k.id === r.requestId) : undefined
    const side = b ?? q
    const root = b ? rootOfBooking(b) : q ? rootOfReq(q) : null
    const job = root ? jobs.get(root) : undefined
    const other = side ? otherParty(side) : null
    // the page that shows the ref: its request (an additional task's own), a booking's request; none for a booking without one
    const page = b ? b.requestId : q?.id
    return root && job && other !== null ? { id: root, number: job.jobNumber, title: job.title, otherParty: other, ...(page && { requestId: page }) } : null
  })
}
