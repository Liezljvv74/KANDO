import { and, eq, inArray, isNull } from 'drizzle-orm'
import { bookings, categoryTexts, db, requests, services, users, type Tx } from '@kando/db'
import { DEFAULT_LANG, t, type Lang } from '@kando/i18n'
import { jobTitle } from './job-ref'

// No imports from requests, notify, chat or the issuing modules: everything that numbers a job reads through here.
type Db = Tx | typeof db


/**
 * Job number, title and task numbers for DTOs. The mappers are sync and read one row, so every DTO that leaves the server goes
 * through withRequestRefs or withBookingRefs. An additional task is a request of its own (own, unused job number): its refs are
 * the ROOT job's, found by following parent_booking_id up to the root booking. Requests and bookings are read on `x` (the caller
 * is a party, so row security shows them; a row just inserted on the request connection is not visible on the owner one); the
 * service title, category names and language are public or own data and are read on the owner connection, so a hidden service
 * (suspended provider) or a deleted one never leaves the title empty: service title, else the category name, else a fixed text.
 * Rule: a caller that already holds an OWNER transaction passes it as `owner` (and as `x`), so no second pooled connection is
 * checked out while its locks are held; request-transaction callers leave `owner` out (they read on the request connection
 * first, the public data on the owner pool after).
 */
export async function rootsOf(x: Db, bookingIds: string[]): Promise<Map<string, { id: string; requestId: string | null }>> {
  const rows = new Map<string, { id: string; requestId: string | null; parentBookingId: string | null }>()
  let todo = [...new Set(bookingIds)]
  for (let i = 0; i < 8 && todo.length; i++) {
    const found = await x.select({ id: bookings.id, requestId: bookings.requestId, parentBookingId: bookings.parentBookingId }).from(bookings).where(inArray(bookings.id, todo))
    for (const r of found) rows.set(r.id, r)
    todo = [...new Set(found.flatMap((r) => (r.parentBookingId && !rows.has(r.parentBookingId) ? [r.parentBookingId] : [])))]
  }
  const out = new Map<string, { id: string; requestId: string | null }>()
  for (const id of bookingIds) {
    let r = rows.get(id)
    for (let i = 0; r?.parentBookingId && rows.has(r.parentBookingId) && i < 8; i++) r = rows.get(r.parentBookingId)
    if (r) out.set(id, { id: r.id, requestId: r.requestId })
  }
  return out
}

/** The root request of a request: itself, or (an additional task) its parent booking's root request from `rootsOf`; null when that root has no request (booked direct). */
export const rootRequestId = (r: { id: string; parentBookingId: string | null }, roots: Map<string, { requestId: string | null }>): string | null =>
  r.parentBookingId ? roots.get(r.parentBookingId)?.requestId ?? null : r.id

/** Root request id > job number and title, for the given root request ids. */
export async function rootJobs(x: Db, rootRequestIds: string[], userId?: string, owner: Db = db): Promise<Map<string, { jobNumber: number; title: string }>> {
  const out = new Map<string, { jobNumber: number; title: string }>()
  if (!rootRequestIds.length) return out
  const reqs = await x.select({ id: requests.id, n: requests.jobNumber, serviceId: requests.serviceId, categoryId: requests.categoryId }).from(requests).where(inArray(requests.id, rootRequestIds))
  const lang = ((userId && (await owner.select({ l: users.language }).from(users).where(eq(users.id, userId)))[0]?.l) || DEFAULT_LANG) as Lang
  const serviceIds = reqs.flatMap((r) => (r.serviceId ? [r.serviceId] : []))
  const svc = new Map((serviceIds.length ? await owner.select({ id: services.id, title: services.title, categoryId: services.categoryId }).from(services).where(inArray(services.id, serviceIds)) : []).map((r) => [r.id, r]))
  const catOf = (r: (typeof reqs)[number]) => r.categoryId ?? (r.serviceId ? svc.get(r.serviceId)?.categoryId : undefined)
  const catIds = [...new Set(reqs.flatMap((r) => catOf(r) ?? []))]
  const names = catIds.length ? await owner.select({ id: categoryTexts.categoryId, lang: categoryTexts.lang, name: categoryTexts.name }).from(categoryTexts).where(inArray(categoryTexts.categoryId, catIds)) : []
  for (const r of reqs) {
    const mine = names.filter((n) => n.id === catOf(r))
    const name = (mine.find((n) => n.lang === lang) ?? mine.find((n) => n.lang === DEFAULT_LANG))?.name ?? ''
    out.set(r.id, { jobNumber: r.n, title: jobTitle(r.serviceId ? svc.get(r.serviceId)?.title : null, name) || t(lang, 'job.fallbackTitle') })
  }
  return out
}

/**
 * Task positions for the root requests' jobs: booking id > position (2, 3, ... in creation order, created_at then id) for every
 * additional task below ANY root booking of the request (a re-booked request has several), at any depth. A root booking is not in
 * the map (position 1). One rule for the app, the invoice and the quote.
 */
export async function taskPositions(x: Db, rootRequestIds: string[]): Promise<Map<string, number>> {
  const position = new Map<string, number>()
  if (!rootRequestIds.length) return position
  const rootBookings = await x.select({ id: bookings.id, requestId: bookings.requestId }).from(bookings).where(and(inArray(bookings.requestId, rootRequestIds), isNull(bookings.parentBookingId)))
  const jobOfBooking = new Map(rootBookings.map((r) => [r.id, r.requestId!]))
  const family = new Map<string, { id: string; at: number }[]>() // root request id > its tasks
  let frontier = rootBookings.map((r) => r.id)
  for (let i = 0; i < 8 && frontier.length; i++) {
    const kids = await x.select({ id: bookings.id, parent: bookings.parentBookingId, createdAt: bookings.createdAt }).from(bookings).where(inArray(bookings.parentBookingId, frontier))
    for (const k of kids) {
      const job = jobOfBooking.get(k.parent!)!
      jobOfBooking.set(k.id, job)
      family.set(job, [...(family.get(job) ?? []), { id: k.id, at: k.createdAt.getTime() }])
    }
    frontier = kids.map((k) => k.id)
  }
  for (const kids of family.values()) kids.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1)).forEach((k, i) => position.set(k.id, i + 2))
  return position
}
