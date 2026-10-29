import { desc, eq } from 'drizzle-orm'
import { bookings, providers, services, type Tx } from '@kando/db'
import type { Booking, BookingAnswer, DirectBookingInput } from '@kando/contract'
import { isUuid } from '../admin/common'
import { offerableServiceIds } from '../providers/eligibility'
import { fail } from '../providers/http'
import { isSuspendedNow, ownProvider } from '../providers/profile'
import { assertSlotFree, lockProviderSlots } from './busy'
import { toBooking } from './requests'
import { assertFuture, canTransition, PROPOSAL_ANSWER_HOURS, payBy } from './rules'

const HOUR = 3_600_000
const NO_ID = '00000000-0000-0000-0000-000000000000'
const notFound = () => fail(404, { error: 'Not found' })
type Row = typeof bookings.$inferSelect

/** The job address stays private to the customer; the provider sees it only once the booking was accepted (payBy is set then). */
const view = (b: Row, userId: string): Booking => {
  const dto = toBooking(b)
  return b.customerId !== userId && b.payBy === null ? { ...dto, address: null } : dto
}

export async function createDirectBooking(tx: Tx, userId: string, input: DirectBookingInput, now = new Date()): Promise<Booking> {
  const service = (await tx.select().from(services).where(eq(services.id, input.serviceId)))[0]
  const provider = service && (await tx.select().from(providers).where(eq(providers.id, service.providerId)))[0]
  if (!service || !provider || provider.status !== 'published' || (await isSuspendedNow(tx, provider.id))) return notFound()
  if (provider.ownerId === userId) fail(400, { error: 'own-service' })
  if (service.priceType !== 'fixed' || service.price === null || !(await offerableServiceIds(tx, provider.id)).includes(service.id)) return fail(400, { error: 'not-bookable' })
  const startAt = new Date(input.startAt)
  assertFuture(startAt, now)
  if (!input.onSite && !provider.worksRemotely) fail(400, { error: 'on-site-required' })
  const [row] = await tx
    .insert(bookings)
    .values({
      customerId: userId,
      providerId: provider.id,
      serviceId: service.id,
      source: 'direct',
      status: 'proposed',
      startAt,
      durationMin: input.durationMin,
      amount: service.price, // from the stored service, never from the client
      currency: service.currency,
      onSite: input.onSite,
      ...(input.onSite && input.address && { addressStreet: input.address.street ?? null, addressPostcode: input.address.postcode, addressCity: input.address.city ?? null }),
      note: input.note ?? null,
      answerBy: new Date(now.getTime() + PROPOSAL_ANSWER_HOURS * HOUR),
      createdAt: now,
      updatedAt: now,
    })
    .returning()
  return view(row!, userId)
}

/** The caller's bookings, newest first, as customer or as provider owner. */
export async function listBookings(tx: Tx, userId: string, role: 'customer' | 'provider'): Promise<Booking[]> {
  const mine = role === 'customer' ? eq(bookings.customerId, userId) : eq(bookings.providerId, (await ownProvider(tx, userId))?.id ?? NO_ID)
  return (await tx.select().from(bookings).where(mine).orderBy(desc(bookings.createdAt), desc(bookings.id))).map((b) => view(b, userId))
}

/** Which side the caller is on; 404 for anyone else. */
async function partyOf(tx: Tx, userId: string, bookingId: string) {
  const b = isUuid(bookingId) ? (await tx.select().from(bookings).where(eq(bookings.id, bookingId)))[0] : undefined
  if (!b) return notFound()
  const role = b.customerId === userId ? 'customer' : (await ownProvider(tx, userId))?.id === b.providerId ? 'provider' : null
  return role ? { role, providerId: b.providerId } : notFound()
}

const lockRow = async (tx: Tx, id: string) => (await tx.select().from(bookings).where(eq(bookings.id, id)).for('update'))[0] ?? notFound()

/** Answer the other side's last proposal: accept, decline or counter. Works for quote-born and direct bookings alike. */
export async function answerBooking(tx: Tx, userId: string, bookingId: string, answer: BookingAnswer, now = new Date()): Promise<Booking> {
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
    return view(row!, userId)
  }
  if (answer.type === 'decline') return set('declined', { answerBy: null, counterBy: null })
  if (!provider || provider.status !== 'published' || (await isSuspendedNow(tx, provider.id))) return fail(409, { error: 'provider-unavailable' })
  if (answer.type === 'counter') {
    const startAt = new Date(answer.startAt)
    assertFuture(startAt, now)
    if (!answer.onSite && !provider.worksRemotely) fail(400, { error: 'on-site-required' })
    // limitation: the answer schema carries no address, so a remote booking cannot be countered to on-site
    if (answer.onSite && !b.addressPostcode) fail(400, { error: 'address-required' })
    const noAddress = answer.onSite ? {} : { addressStreet: null, addressPostcode: null, addressCity: null } // remote needs no address
    return set('proposed', { startAt, durationMin: answer.durationMin, onSite: answer.onSite, ...noAddress, counterBy: role, answerBy: new Date(now.getTime() + PROPOSAL_ANSWER_HOURS * HOUR) })
  }
  assertFuture(b.startAt, now)
  await assertSlotFree(tx, b.providerId, b.startAt, b.durationMin, b.onSite, b.id)
  return set('awaiting-payment', { payBy: payBy(now, b.startAt), answerBy: null, counterBy: null })
}

/** "I no longer need this": the customer, from proposed or awaiting-payment. */
export async function withdrawBooking(tx: Tx, userId: string, bookingId: string, now = new Date()): Promise<Booking> {
  if ((await partyOf(tx, userId, bookingId)).role !== 'customer') fail(403, { error: 'not-your-turn' })
  const b = await lockRow(tx, bookingId)
  if (!canTransition(b.status as Booking['status'], 'withdrawn')) fail(409, { error: 'not-open' })
  const [row] = await tx.update(bookings).set({ status: 'withdrawn', updatedAt: now }).where(eq(bookings.id, b.id)).returning()
  return view(row!, userId)
}
