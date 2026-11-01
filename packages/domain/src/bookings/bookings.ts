import { and, asc, desc, eq, getTableColumns, inArray, isNull } from 'drizzle-orm'
import { bookingAppInsert, bookings, providers, quotes, services, type Tx } from '@kando/db'
import { HOUR, LIST_PAGE, type Booking, type BookingAnswer, type BookingView, type DirectBookingInput, type Page } from '@kando/contract'
import { NO_ID } from '../admin/common'
import { offerableServiceIds } from '../providers/eligibility'
import { fail, notFound } from '../providers/http'
import { isSuspendedNow, ownProvider } from '../providers/profile'
import type { AfterCommit } from '../app-request'
import { blockedWithProvider } from '../chat/blocks'
import { assertNoContactDetails } from '../chat/flags'
import { threadForBooking, threadIdOf } from '../chat/threads'
import { olderThan, pageOf, stampOf } from '../paging'
import { assertSlotFree, lockProviderSlots } from './busy'
import { lockRow, partyOf } from './party'
import { notifyBookingEvent, notifyProposal } from './notify'
import { assertWithinLimits, toBooking } from './requests'
import { canTransact } from '../payments/rules'
import { assertFuture, canTransition, PROPOSAL_ANSWER_HOURS, payBy } from './rules'

type Row = typeof bookings.$inferSelect

/** The job address stays private to the customer; the provider sees it only once the booking was accepted (payBy is set then). */
export const view = (b: Row, userId: string, now = new Date()): Booking => {
  const dto = toBooking(b, now)
  return b.customerId !== userId && b.payBy === null ? { ...dto, address: null } : dto
}

export async function createDirectBooking(tx: Tx, userId: string, input: DirectBookingInput, now = new Date(), afterCommit: AfterCommit = () => {}): Promise<Booking> {
  await assertWithinLimits(tx, userId, null, now)
  const service = (await tx.select().from(services).where(eq(services.id, input.serviceId)))[0]
  const provider = service && (await tx.select().from(providers).where(eq(providers.id, service.providerId)))[0]
  if (!service || !provider || provider.status !== 'published' || (await isSuspendedNow(tx, provider.id)) || (await blockedWithProvider(tx, userId, provider.id))) return notFound()
  if (provider.ownerId === userId) fail(400, { error: 'own-service' })
  if (!canTransact(provider)) fail(409, { error: 'PROVIDER_NOT_READY' }) // payout set-up unfinished: the app offers "notify me"
  if (service.priceType !== 'fixed' || service.price === null || !(await offerableServiceIds(tx, provider.id)).includes(service.id)) return fail(400, { error: 'not-bookable' })
  const startAt = new Date(input.startAt)
  assertFuture(startAt, now)
  if (!input.onSite && !provider.worksRemotely) fail(400, { error: 'on-site-required' })
  if (input.note) await assertNoContactDetails(userId, input.note)
  const [row] = await tx
    .insert(bookingAppInsert) // the price comes from the service (trigger bookings_fill_amount), never from the client
    .values({
      customerId: userId,
      providerId: provider.id,
      serviceId: service.id,
      source: 'direct',
      status: 'proposed',
      startAt,
      durationMin: input.durationMin,
      onSite: input.onSite,
      ...(input.onSite && input.address && { addressStreet: input.address.street ?? null, addressPostcode: input.address.postcode, addressCity: input.address.city ?? null }),
      note: input.note ?? null,
      answerBy: new Date(now.getTime() + PROPOSAL_ANSWER_HOURS * HOUR),
      createdAt: now,
      updatedAt: now,
    })
    .returning(getTableColumns(bookings))
  await threadForBooking(tx, row!.id) // a direct booking gets its own chat
  notifyProposal(afterCommit, provider, row!)
  return view(row!, userId, now)
}

/**
 * The caller's bookings as customer or as provider owner, a page of root bookings newest first by (created_at, id); each root
 * is followed by its additional tasks (oldest first), so a task is always on its root's page.
 */
export async function listBookings(tx: Tx, userId: string, role: 'customer' | 'provider', cursor?: string): Promise<Page<Booking>> {
  const mine = role === 'customer' ? eq(bookings.customerId, userId) : eq(bookings.providerId, (await ownProvider(tx, userId))?.id ?? NO_ID)
  const found = await tx
    .select({ b: bookings, ts: stampOf(bookings.createdAt), id: bookings.id })
    .from(bookings)
    .where(and(mine, isNull(bookings.parentBookingId), olderThan(bookings.createdAt, bookings.id, cursor)))
    .orderBy(desc(bookings.createdAt), desc(bookings.id))
    .limit(LIST_PAGE + 1)
  const { rows, next } = pageOf(found)
  const kids = rows.length ? await tx.select().from(bookings).where(and(mine, inArray(bookings.parentBookingId, rows.map((r) => r.id)))).orderBy(asc(bookings.createdAt), asc(bookings.id)) : []
  return { docs: rows.flatMap(({ b }) => [view(b, userId), ...kids.filter((k) => k.parentBookingId === b.id).map((k) => view(k, userId))]), next }
}

/** One booking for one of its parties: which side they are on and its chat. Reads only (no timers, no thread is created). */
export async function getBooking(tx: Tx, userId: string, id: string): Promise<BookingView> {
  const { role } = await partyOf(tx, userId, id) // 404 for anyone else
  const b = (await tx.select().from(bookings).where(eq(bookings.id, id)))[0] ?? notFound()
  return { booking: view(b, userId), viewer: role as BookingView['viewer'], threadId: await threadIdOf(tx, b) }
}

/** Answer the other side's last proposal: accept, decline or counter. Works for quote-born and direct bookings alike. */
export async function answerBooking(tx: Tx, userId: string, bookingId: string, answer: BookingAnswer, now = new Date(), afterCommit: AfterCommit = () => {}): Promise<Booking> {
  const { role, providerId } = await partyOf(tx, userId, bookingId) // party check before any lock
  if (answer.type === 'accept') await lockProviderSlots(tx, providerId)
  const b = await lockRow(tx, bookingId) // read again once the row is ours
  if (b.status !== 'proposed' || (b.answerBy && b.answerBy <= now)) fail(409, { error: 'not-open' })
  // the side that made the last proposal cannot answer it (counterBy null = the customer proposed)
  if (role !== (b.counterBy === 'provider' ? 'customer' : 'provider')) fail(403, { error: 'not-your-turn' })
  const provider = (await tx.select().from(providers).where(eq(providers.id, b.providerId)))[0]
  const set = async (to: Booking['status'], patch: Partial<Row>) => {
    if (!canTransition(b.status as Booking['status'], to)) fail(409, { error: 'not-open' })
    const [row] = await tx.update(bookings).set({ ...patch, status: to, updatedAt: now }).where(eq(bookings.id, b.id)).returning()
    return view(row!, userId, now)
  }
  const tell = (kind: 'booking-declined' | 'booking-accepted' | 'request-reopened', extra: Record<string, string> = {}) => role === 'provider' && afterCommit(() => notifyBookingEvent(kind, b.customerId, { bookingId: b.id, ...extra })) // only the provider's answer is told to the customer
  if (answer.type === 'decline') {
    const done = await set('declined', { answerBy: null, counterBy: null })
    // a quote-born booking's quote is open again (trigger bookings_reopen_request): the customer may propose another time
    const reopened = b.quoteId && b.requestId && (await tx.select({ s: quotes.status }).from(quotes).where(eq(quotes.id, b.quoteId)))[0]?.s === 'sent'
    if (reopened) tell('request-reopened', { requestId: b.requestId! })
    else tell('booking-declined')
    return done
  }
  if (!provider || provider.status !== 'published' || (await isSuspendedNow(tx, provider.id))) return fail(409, { error: 'provider-unavailable' })
  // Accepting or proposing a time leads to an obligation (a counter accepted by the other side becomes awaiting-payment):
  // only with payout set-up done. Declining stays possible; bookings accepted earlier are not touched.
  if (!canTransact(provider)) fail(409, { error: role === 'provider' ? 'PAYOUT_SETUP_FIRST' : 'PROVIDER_NOT_READY' })
  if (answer.type === 'counter') {
    const startAt = new Date(answer.startAt)
    assertFuture(startAt, now)
    if (!answer.onSite && !provider.worksRemotely) fail(400, { error: 'on-site-required' })
    // limitation: the answer schema carries no address, so a remote booking cannot be countered to on-site
    if (answer.onSite && !b.addressPostcode) fail(400, { error: 'address-required' })
    const noAddress = answer.onSite ? {} : { addressStreet: null, addressPostcode: null, addressCity: null } // remote needs no address
    const done = await set('proposed', { startAt, durationMin: answer.durationMin, onSite: answer.onSite, ...noAddress, counterBy: role, answerBy: new Date(now.getTime() + PROPOSAL_ANSWER_HOURS * HOUR) })
    // the other side hears of the new time (neutral text: it reads right for both directions)
    afterCommit(() => notifyBookingEvent('booking-proposed', role === 'customer' ? provider.ownerId : b.customerId, { bookingId: b.id }))
    return done
  }
  assertFuture(b.startAt, now)
  await assertSlotFree(tx, b.providerId, b.startAt, b.durationMin, b.onSite, now, b.id)
  const pay = payBy(now, b.startAt)
  const done = await set('awaiting-payment', { payBy: pay, acceptedAt: now, answerBy: null, counterBy: null })
  tell('booking-accepted', { date: pay.toISOString() })
  return done
}

/** "I no longer need this": the customer, from proposed or awaiting-payment. */
export async function withdrawBooking(tx: Tx, userId: string, bookingId: string, now = new Date()): Promise<Booking> {
  if ((await partyOf(tx, userId, bookingId)).role !== 'customer') fail(403, { error: 'not-your-turn' })
  const b = await lockRow(tx, bookingId)
  if (!canTransition(b.status as Booking['status'], 'withdrawn')) fail(409, { error: 'not-open' })
  const [row] = await tx.update(bookings).set({ status: 'withdrawn', updatedAt: now }).where(eq(bookings.id, b.id)).returning()
  return view(row!, userId, now)
}
