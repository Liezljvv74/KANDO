import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { db, pool } from '@kando/db'
import { QuoteSchema, RequestSchema } from '@kando/contract'
import { clearOutbox, notifyBookingEvent, runDueTimers } from '@kando/domain'
import { outboxForTests } from '@kando/domain/src/testing'
import { requestTime, call, cleanupUsers, makeAwaitingPayment, seedBase, seedProvider, seedUser } from './helpers'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const requests = await import('../app/app-api/v1/requests/route')
const quotes = await import('../app/app-api/v1/requests/[id]/quotes/route')

const U = { cust: 'bn-cust', cust2: 'bn-cust2', owner: 'bn-owner' }
let prov: string
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString()
const rows = async (uid: string) => (await pool.query('SELECT kind, payload FROM notifications WHERE user_id = $1 ORDER BY created_at', [uid])).rows
const subjects = (to: string) => outboxForTests().filter((m) => m.to === `${to}@test.skilled.invalid`)

beforeAll(async () => {
  await cleanupUsers()
  const { categoryId } = await seedBase()
  await seedUser(U.cust)
  await seedUser(U.cust2)
  prov = await seedProvider(U.owner, { name: 'Bn Owner', categoryId })
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

it('a request: one in-app row and one German email for the provider', async () => {
  const res = await call(requests.POST, U.cust, 'POST', { providerId: prov, description: 'Bitte helfen', ...requestTime() })
  const r = RequestSchema.parse(await res.json())
  expect(await rows(U.owner)).toEqual([{ kind: 'request-received', payload: { requestId: r.id } }])
  expect(subjects(U.owner).map((m) => m.subject)).toEqual([expect.stringMatching(/^\#\d+ .+: Du hast eine neue Anfrage$/)])
})

it('a quote: the customer gets one row and an English email naming the 7-day expiry date', async () => {
  await pool.query("UPDATE users SET language = 'en' WHERE id = $1", [U.cust])
  const r = RequestSchema.parse(await (await call(requests.POST, U.cust, 'POST', { providerId: prov, description: 'x', ...requestTime() })).json())
  clearOutbox()
  const q = QuoteSchema.parse(await (await call(quotes.POST, U.owner, 'POST', { amount: 50, scope: 'Work' }, { id: r.id })).json())
  expect(await rows(U.cust)).toEqual([{ kind: 'quote-received', payload: { requestId: r.id, quoteId: q.id } }])
  const mail = subjects(U.cust)
  expect(mail).toHaveLength(1)
  expect(mail[0]!.subject).toMatch(/^#\d+ .+: You have received a quote$/)
  const expiry = new Date(q.expiresAt).toLocaleDateString('en-GB', { timeZone: 'Europe/Berlin' })
  expect(mail[0]!.text).toContain(expiry)
  expect(mail[0]!.text).toContain('7 days')
})

it('confirming a quote with a time tells the provider and sends the customer "Payment due" with the pay-by date', async () => {
  clearOutbox()
  const b = await makeAwaitingPayment({ customerId: U.cust, ownerId: U.owner, providerId: prov, startAt: day(30) })
  const owner = (await rows(U.owner)).filter((x) => x.kind === 'quote-confirmed')
  expect(owner).toEqual([{ kind: 'quote-confirmed', payload: { bookingId: b.id } }])
  expect((await rows(U.cust)).filter((x) => x.kind === 'booking-accepted')).toHaveLength(1)
  expect(subjects(U.cust).map((m) => m.subject).some((x) => x.endsWith(': Zahlung fällig für Deine Buchung'))).toBe(true)
})

it('timer events: the SQL writes the one row, notifyBookingEvent adds only the email (no duplicate row)', async () => {
  const stamp = new Date(Date.now() + 40 * 86_400_000)
  await pool.query("INSERT INTO requests (customer_id, provider_id, description, status, answer_by) VALUES ($1, $2, 'x', 'open', $3)", [U.cust, prov, new Date(stamp.getTime() - 86_400_000)])
  await runDueTimers(db, stamp)
  expect((await rows(U.cust)).filter((x) => x.kind === 'request-expired')).toHaveLength(1)
  const mail = subjects(U.cust).filter((m) => m.subject.endsWith('Deine Anfrage wurde nicht beantwortet'))
  expect(mail).toHaveLength(1)
  expect(mail[0]!.text).toContain('anderen Anbieter')
})

it('requests-ignored email explains the damage in English, with no row from notify itself', async () => {
  await pool.query("UPDATE users SET language = 'en' WHERE id = $1", [U.owner])
  await notifyBookingEvent('requests-ignored', U.owner, {}, { written: true })
  expect(await rows(U.owner)).toEqual([])
  const m = subjects(U.owner)[0]!
  expect(m.text).toMatch(/customers leave/)
  expect(m.text).toMatch(/withdraw your services/)
})

it('never throws: unknown user, broken ids', async () => {
  await expect(notifyBookingEvent('quote-received', 'nobody', { quoteId: 'not-a-uuid' })).resolves.toBeUndefined()
  await expect(notifyBookingEvent('payment-reminder', U.cust, { bookingId: 'not-a-uuid' }, { written: true })).resolves.toBeUndefined()
})

it('the quote email states the 7-day expiry in German too', async () => {
  const r = RequestSchema.parse(await (await call(requests.POST, U.cust, 'POST', { providerId: prov, description: 'x', ...requestTime() })).json())
  clearOutbox()
  const q = QuoteSchema.parse(await (await call(quotes.POST, U.owner, 'POST', { amount: 50, scope: 'Work' }, { id: r.id })).json())
  const mail = subjects(U.cust)[0]!
  expect(mail.text).toContain(new Date(q.expiresAt).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric' }))
  expect(mail.text).toContain('7 Tage')
})

it('real sweeps: quote-expiring and payment-reminder emails carry their dates, one row each', async () => {
  // 06:00 UTC on a day 60 days ahead: the dates 2 h and 12 h later fall on the same calendar day in Berlin whatever the time of the test run
  const today = new Date()
  const stamp = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 60, 6, 0))
  const r = (await pool.query("INSERT INTO requests (customer_id, provider_id, description, status, answer_by) VALUES ($1, $2, 'x', 'quoted', $3) RETURNING id", [U.cust, prov, new Date(stamp.getTime() + 86_400_000)])).rows[0].id
  const expires = new Date(stamp.getTime() + 12 * 3_600_000)
  const quoteId = (await pool.query("INSERT INTO quotes (request_id, provider_id, amount, scope, expires_at) VALUES ($1, $2, 50, 's', $3) RETURNING id", [r, prov, expires])).rows[0].id
  const payBy = new Date(stamp.getTime() + 2 * 3_600_000)
  await pool.query("INSERT INTO bookings (customer_id, provider_id, quote_id, source, status, start_at, duration_min, pay_by, accepted_at) VALUES ($1, $2, $3, 'quote', 'awaiting-payment', $4, 60, $5, $6)", [U.cust, prov, quoteId, new Date(stamp.getTime() + 5 * 86_400_000), payBy, new Date(stamp.getTime() - 86_400_000)])
  await runDueTimers(db, stamp)
  expect((await rows(U.cust)).map((x) => x.kind).sort()).toEqual(['payment-reminder', 'quote-expiring'])
  const de = (d: Date) => d.toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric' })
  const mails = subjects(U.cust)
  expect(mails.find((m) => m.subject.endsWith('Dein Angebot läuft bald ab'))!.text).toContain(de(expires))
  expect(mails.find((m) => m.subject.endsWith('Bitte bezahle Deine Buchung'))!.text).toContain(de(payBy))
  expect(mails).toHaveLength(2)
})

it('real sweep: requests-ignored goes to the provider as one row and one email', async () => {
  const stamp = new Date(Date.now() + 70 * 86_400_000)
  for (let i = 0; i < 3; i++) await pool.query("INSERT INTO requests (customer_id, provider_id, description, status, answer_by, updated_at) VALUES ($1, $2, 'x', 'expired', $3, $4)", [U.cust, prov, new Date(stamp.getTime() - 86_400_000), new Date(stamp.getTime() - 3_600_000)])
  await runDueTimers(db, stamp)
  expect(await rows(U.owner)).toEqual([{ kind: 'requests-ignored', payload: {} }])
  const mails = subjects(U.owner)
  expect(mails).toHaveLength(1)
  expect(mails[0]!.text).toContain('info@skillweb.space')
})

it('listNotifications adds job number, title and other party; the email names the job; a non-party gets null', async () => {
  const { listNotifications, jobsForNotices, jobLabel } = await import('@kando/domain')
  const r = RequestSchema.parse(await (await call(requests.POST, U.cust, 'POST', { providerId: prov, description: 'Bitte helfen', ...requestTime() })).json())
  const [n] = await listNotifications(db as never, U.owner)
  expect(n!.payload).toEqual({ requestId: r.id }) // stored payload unchanged
  expect(n!.job).toMatchObject({ id: r.id, number: r.jobNumber, title: r.title })
  expect(typeof n!.job!.otherParty).toBe('string')
  expect(subjects(U.owner)[0]!.subject).toContain(jobLabel(n!.job!))
  expect(await jobsForNotices(db as never, U.cust2, [{ requestId: r.id }, { requestId: 'not-an-id' }])).toEqual([null, null])
})
