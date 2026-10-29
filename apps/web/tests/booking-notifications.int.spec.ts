import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { db, pool } from '@kando/db'
import { BookingSchema, QuoteSchema, RequestSchema } from '@kando/contract'
import { clearOutbox, notifyBookingEvent, outboxForTests, runDueTimers } from '@kando/domain'
import { call, cleanupUsers, seedBase, seedProvider, seedUser } from './helpers'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const bookingsRoute = await import('../app/app-api/v1/bookings/route')
const answer = await import('../app/app-api/v1/bookings/[id]/answer/route')
const requests = await import('../app/app-api/v1/requests/route')
const quotes = await import('../app/app-api/v1/requests/[id]/quotes/route')
const accept = await import('../app/app-api/v1/quotes/[id]/accept/route')

const U = { cust: 'bn-cust', cust2: 'bn-cust2', owner: 'bn-owner' }
let prov: string, service: string
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString()
const rows = async (uid: string) => (await pool.query('SELECT kind, payload FROM notifications WHERE user_id = $1 ORDER BY created_at', [uid])).rows
const subjects = (to: string) => outboxForTests().filter((m) => m.to === `${to}@test.skilled.invalid`)

beforeAll(async () => {
  await cleanupUsers()
  const { categoryId } = await seedBase()
  await seedUser(U.cust)
  await seedUser(U.cust2)
  prov = await seedProvider(U.owner, { name: 'Bn Owner', categoryId })
  service = (await pool.query('SELECT id FROM services WHERE provider_id = $1', [prov])).rows[0].id
})
beforeEach(async () => {
  vi.stubEnv('RESEND_API_KEY', '')
  await pool.query("DELETE FROM notifications WHERE user_id LIKE 'bn-%'")
  await pool.query("DELETE FROM bookings WHERE customer_id LIKE 'bn-%'")
  await pool.query("DELETE FROM requests WHERE customer_id LIKE 'bn-%'")
  await pool.query("UPDATE users SET language = 'de' WHERE id = ANY($1)", [[U.cust, U.cust2, U.owner]])
  clearOutbox()
})
afterAll(cleanupUsers)

const proposal = (n: number, extra: object = {}) => ({ serviceId: service, startAt: day(n), durationMin: 60, onSite: true, address: { postcode: '10115' }, ...extra })

it('a request: one in-app row and one German email for the provider', async () => {
  const res = await call(requests.POST, U.cust, 'POST', { providerId: prov, description: 'Bitte helfen' })
  const r = RequestSchema.parse(await res.json())
  expect(await rows(U.owner)).toEqual([{ kind: 'request-received', payload: { requestId: r.id } }])
  expect(subjects(U.owner).map((m) => m.subject)).toEqual(['Du hast eine neue Anfrage'])
})

it('a quote: the customer gets one row and an English email naming the 7-day expiry date', async () => {
  await pool.query("UPDATE users SET language = 'en' WHERE id = $1", [U.cust])
  const r = RequestSchema.parse(await (await call(requests.POST, U.cust, 'POST', { providerId: prov, description: 'x' })).json())
  clearOutbox()
  const q = QuoteSchema.parse(await (await call(quotes.POST, U.owner, 'POST', { amount: 50, scope: 'Work' }, { id: r.id })).json())
  expect(await rows(U.cust)).toEqual([{ kind: 'quote-received', payload: { requestId: r.id, quoteId: q.id } }])
  const mail = subjects(U.cust)
  expect(mail).toHaveLength(1)
  expect(mail[0]!.subject).toBe('You have received a quote')
  const expiry = new Date(q.expiresAt).toLocaleDateString('en-GB', { timeZone: 'Europe/Berlin' })
  expect(mail[0]!.text).toContain(expiry)
  expect(mail[0]!.text).toContain('7 days')
})

it('accepting a quote tells the provider of the proposal; a direct booking on a time awaiting payment also sends pending-slot-requested', async () => {
  const r = RequestSchema.parse(await (await call(requests.POST, U.cust, 'POST', { providerId: prov, description: 'x' })).json())
  const q = QuoteSchema.parse(await (await call(quotes.POST, U.owner, 'POST', { amount: 50, scope: 'Work' }, { id: r.id })).json())
  await pool.query("DELETE FROM notifications WHERE user_id = $1", [U.owner])
  const b = BookingSchema.parse(await (await call(accept.POST, U.cust, 'POST', { startAt: day(30), durationMin: 60, onSite: true, address: { postcode: '10115' } }, { id: q.id })).json())
  expect((await rows(U.owner)).map((x) => x.kind)).toEqual(['booking-proposed'])
  expect((await rows(U.owner))[0]!.payload).toEqual({ bookingId: b.id })
  // the provider accepts: the customer is told, with the pay-by date
  clearOutbox()
  await call(answer.POST, U.owner, 'POST', { type: 'accept' }, { id: b.id })
  expect((await rows(U.cust)).map((x) => x.kind)).toContain('booking-accepted')
  expect(subjects(U.cust).map((m) => m.subject)).toEqual(['Deine Buchung wurde angenommen'])
  // another customer proposes an overlapping time
  await pool.query("DELETE FROM notifications WHERE user_id = $1", [U.owner])
  const other = BookingSchema.parse(await (await call(bookingsRoute.POST, U.cust2, 'POST', proposal(0, { startAt: day(30) }))).json())
  expect((await rows(U.owner)).map((x) => x.kind).sort()).toEqual(['booking-proposed', 'pending-slot-requested'])
  expect(other.status).toBe('proposed')
})

it('declining a booking tells the customer once', async () => {
  const b = BookingSchema.parse(await (await call(bookingsRoute.POST, U.cust, 'POST', proposal(40))).json())
  await call(answer.POST, U.owner, 'POST', { type: 'decline' }, { id: b.id })
  expect((await rows(U.cust)).map((x) => x.kind)).toEqual(['booking-declined'])
  expect(subjects(U.cust)).toHaveLength(1)
})

it('timer events: the SQL writes the one row, notifyBookingEvent adds only the email (no duplicate row)', async () => {
  const stamp = new Date(Date.now() + 40 * 86_400_000)
  await pool.query("INSERT INTO requests (customer_id, provider_id, description, status, answer_by) VALUES ($1, $2, 'x', 'open', $3)", [U.cust, prov, new Date(stamp.getTime() - 86_400_000)])
  await runDueTimers(db, stamp)
  expect((await rows(U.cust)).filter((x) => x.kind === 'request-expired')).toHaveLength(1)
  const mail = subjects(U.cust).filter((m) => m.subject === 'Deine Anfrage wurde nicht beantwortet')
  expect(mail).toHaveLength(1)
  expect(mail[0]!.text).toContain('anderen Anbieter')
})

it('requests-ignored email explains the damage in English, with no row from notify itself', async () => {
  await pool.query("UPDATE users SET language = 'en' WHERE id = $1", [U.owner])
  await notifyBookingEvent('requests-ignored', U.owner, {})
  expect(await rows(U.owner)).toEqual([])
  const m = subjects(U.owner)[0]!
  expect(m.text).toMatch(/customers leave/)
  expect(m.text).toMatch(/withdraw your services/)
})

it('never throws: unknown user, broken ids', async () => {
  await expect(notifyBookingEvent('quote-received', 'nobody', { quoteId: 'not-a-uuid' })).resolves.toBeUndefined()
  await expect(notifyBookingEvent('payment-reminder', U.cust, { bookingId: 'not-a-uuid' })).resolves.toBeUndefined()
})
