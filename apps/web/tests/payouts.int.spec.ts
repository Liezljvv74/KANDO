import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { db, pool } from '@kando/db'
import { appPool } from '@kando/db/src/client'
import { BookingSchema, ProviderDetailSchema, RequestSchema } from '@kando/contract'
import { clearOutbox, notifyBookingEvent, outboxForTests, refreshAccount, runDueTimers, setGatewayForTests } from '@kando/domain'
import { call, cleanupUsers, EMAIL, relaxLimits, seedBase, seedProvider, seedUser } from './helpers'
import { fakeGateway, type FakeGateway } from './fake-gateway'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const setup = await import('../app/app-api/v1/payouts/setup/route')
const status = await import('../app/app-api/v1/payouts/status/route')
const notifyMe = await import('../app/app-api/v1/providers/[slug]/notify-me/route')
const profileRoute = await import('../app/app-api/v1/providers/[slug]/route')
const requestsRoute = await import('../app/app-api/v1/requests/route')
const quotesRoute = await import('../app/app-api/v1/requests/[id]/quotes/route')
const acceptQuoteRoute = await import('../app/app-api/v1/quotes/[id]/accept/route')
const bookingsRoute = await import('../app/app-api/v1/bookings/route')
const answer = await import('../app/app-api/v1/bookings/[id]/answer/route')
const webhook = await import('../app/api/stripe/webhook/route')
const exportRoute = await import('../app/app-api/v1/me/export/route')

const U = { c1: 'po-c1', c2: 'po-c2', c3: 'po-c3', third: 'po-third' }
const DAY = 86_400_000
const HOUR = 3_600_000
let categoryId: string
let g: FakeGateway
let n = 0

beforeAll(async () => {
  await cleanupUsers()
  categoryId = (await seedBase()).categoryId
  for (const u of Object.values(U)) await seedUser(u)
})
beforeEach(async () => {
  await pool.query("UPDATE providers SET stripe_account_id = NULL WHERE owner_id LIKE 'po-%'") // each test's fake gateway numbers its accounts from 1 again
  vi.stubEnv('PAYMENTS_ENABLED', 'true')
  g = fakeGateway()
  setGatewayForTests(g)
  clearOutbox()
})
afterEach(() => {
  setGatewayForTests(undefined)
  vi.unstubAllEnvs()
})
afterAll(cleanupUsers)

/** A published provider with one fixed-price service; no payout set-up. */
async function provider(): Promise<{ uid: string; id: string; slug: string; serviceId: string }> {
  const uid = `po-p${++n}`
  const id = await seedProvider(uid, { name: `Po Prov ${n}`, categoryId, price: 80 })
  await pool.query('UPDATE providers SET invoice_consent_at = now() WHERE id = $1', [id]) // invoicing agreed: these tests are about the payout set-up
  const serviceId = (await pool.query('SELECT id FROM services WHERE provider_id = $1', [id])).rows[0].id
  return { uid, id, slug: `${uid}-slug`, serviceId }
}
const prow = async (id: string) => (await pool.query('SELECT stripe_account_id, payouts_ready_at FROM providers WHERE id = $1', [id])).rows[0]
const startSetup = (uid: string) => call(setup.POST, uid, 'POST')
const getStatus = (uid: string) => call(status.GET, uid)
const profile = async (slug: string) => ProviderDetailSchema.parse(await (await call(profileRoute.GET, U.third, 'GET', undefined, { slug })).json())
const watch = (slug: string, as: string) => call(notifyMe.POST, as, 'POST', undefined, { slug })
const unwatch = (slug: string, as: string) => call(notifyMe.DELETE, as, 'DELETE', undefined, { slug })
const kindsFor = async (uid: string, kind: string) => (await pool.query('SELECT payload FROM notifications WHERE user_id = $1 AND kind = $2 ORDER BY created_at, id', [uid, kind])).rows
const day = (k: number) => new Date(Date.now() + k * DAY).toISOString()
const proposal = { startAt: day(10), durationMin: 60, onSite: true, address: { postcode: '10115' } }
const ready = (id: string) => pool.query('UPDATE providers SET payouts_ready_at = now(), invoice_consent_at = now() WHERE id = $1', [id])
/** With payments off (as before the switch): a request, a direct booking and a quote are made the normal way. */
async function whilePaymentsOff<T>(fn: () => Promise<T>): Promise<T> {
  vi.stubEnv('PAYMENTS_ENABLED', 'false')
  try {
    return await fn()
  } finally {
    vi.stubEnv('PAYMENTS_ENABLED', 'true')
  }
}
const newRequest = async (providerId: string, as = U.c1) => {
  await relaxLimits(as)
  const res = await call(requestsRoute.POST, as, 'POST', { providerId, description: 'Paint the hall' })
  expect(res.status).toBe(201)
  return RequestSchema.parse(await res.json())
}
const newBooking = async (serviceId: string, as = U.c1, startAt = day(10 + ++n / 10)) => {
  await relaxLimits(as)
  const res = await call(bookingsRoute.POST, as, 'POST', { ...proposal, startAt, serviceId })
  expect(res.status).toBe(201)
  return BookingSchema.parse(await res.json())
}
const deliver = (accountId: string) => {
  const signed = g.event({ id: `evt_${randomUUID()}`, type: 'account-updated', accountId })
  return webhook.POST(new Request('http://localhost/api/stripe/webhook', { method: 'POST', body: signed.body, headers: { 'stripe-signature': signed.signature } }))
}

it('set-up creates one account and returns a link; a second call reuses the account', async () => {
  const p = await provider()
  const res = await startSetup(p.uid)
  expect(res.status).toBe(200)
  const { url } = await res.json()
  expect(url).toBe('https://stripe.fake/onboarding/acct_fake_1')
  expect(g.calls.find((c) => c.method === 'createAccount')!.args).toEqual({ email: EMAIL(p.uid), country: 'DE', providerId: p.id, idempotencyKey: `account:${p.id}` })
  expect((await prow(p.id)).stripe_account_id).toBe('acct_fake_1') // stored on the owner connection (staff-only column)
  const link = g.calls.find((c) => c.method === 'onboardingLink')!.args as { returnUrl: string; refreshUrl: string }
  for (const u of [link.returnUrl, link.refreshUrl]) {
    expect(u).toMatch(/\/payout-done$/) // German user: no ?lang
    expect(u).not.toContain(p.id)
    expect(u).not.toContain('acct_')
  }
  const again = await startSetup(p.uid)
  expect(again.status).toBe(200)
  expect(g.attempts.createAccount).toBe(1) // the stored account is reused: no second create
  expect(g.calls.filter((c) => c.method === 'onboardingLink')).toHaveLength(2) // a fresh link every time
})

it('onboardingLink and accountReady run with no request transaction open', async () => {
  const p = await provider()
  const open: Record<string, number> = {}
  const link = g.onboardingLink
  const readyFn = g.accountReady
  g.onboardingLink = async (a) => ((open.onboardingLink = appPool.totalCount - appPool.idleCount), link(a))
  g.accountReady = async (a) => ((open.accountReady = appPool.totalCount - appPool.idleCount), readyFn(a))
  expect((await startSetup(p.uid)).status).toBe(200)
  expect((await getStatus(p.uid)).status).toBe(200)
  expect(open).toEqual({ onboardingLink: 0, accountReady: 0 })
})

it('two parallel set-ups create one account', async () => {
  const p = await provider()
  const [a, b] = await Promise.all([startSetup(p.uid), startSetup(p.uid)])
  expect([a.status, b.status]).toEqual([200, 200])
  expect((await a.json()).url).toBe((await b.json()).url)
  expect(g.calls.filter((c) => c.method === 'createAccount')).toHaveLength(1)
  expect(g.attempts.createAccount).toBe(1) // the second waited and found the stored account
})

it('status turns ready and the public profile shows verified', async () => {
  const p = await provider()
  expect(await (await getStatus(p.uid)).json()).toEqual({ ready: false }) // no account yet: the gateway is not asked
  expect(g.attempts.accountReady ?? 0).toBe(0)
  await startSetup(p.uid)
  const acct = (await prow(p.id)).stripe_account_id as string
  expect(await (await getStatus(p.uid)).json()).toEqual({ ready: false })
  expect(await profile(p.slug)).toMatchObject({ verified: false, canBook: false })
  g.ready.add(acct)
  expect(await (await getStatus(p.uid)).json()).toEqual({ ready: true })
  expect((await prow(p.id)).payouts_ready_at).not.toBeNull()
  expect(await profile(p.slug)).toMatchObject({ verified: true, canBook: true })
  expect(await kindsFor(p.uid, 'payout-setup-complete')).toHaveLength(1)
  await getStatus(p.uid) // still ready: no second notice
  expect(await kindsFor(p.uid, 'payout-setup-complete')).toHaveLength(1)
  expect(outboxForTests().filter((m) => m.to === EMAIL(p.uid))).toHaveLength(1)
})

it('a provider without set-up cannot send a quote or accept (409); with set-up they can', async () => {
  const p = await provider()
  const { req, b1, b2 } = await whilePaymentsOff(async () => ({ b1: await newBooking(p.serviceId), b2: await newBooking(p.serviceId), req: await newRequest(p.id) }))
  const refused = async (res: Response, error: string) => {
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe(error)
  }
  await refused(await call(quotesRoute.POST, p.uid, 'POST', { amount: 100, scope: 'Hall' }, { id: req.id }), 'PAYOUT_SETUP_FIRST')
  await refused(await call(answer.POST, p.uid, 'POST', { type: 'accept' }, { id: b1.id }), 'PAYOUT_SETUP_FIRST')
  await refused(await call(answer.POST, p.uid, 'POST', { type: 'counter', startAt: day(12), durationMin: 60, onSite: true }, { id: b1.id }), 'PAYOUT_SETUP_FIRST')
  expect((await call(answer.POST, p.uid, 'POST', { type: 'decline' }, { id: b2.id })).status).toBe(200) // saying no is always possible
  await ready(p.id)
  expect((await call(quotesRoute.POST, p.uid, 'POST', { amount: 100, scope: 'Hall' }, { id: req.id })).status).toBe(201)
  const accepted = await call(answer.POST, p.uid, 'POST', { type: 'accept' }, { id: b1.id })
  expect(accepted.status).toBe(200)
  expect((await accepted.json()).status).toBe('awaiting-payment')
})

it('a provider who stops being ready: the customer cannot accept their quote or counter; bookings already accepted stay', async () => {
  const p = await provider()
  await ready(p.id)
  const b = await newBooking(p.serviceId)
  expect((await call(answer.POST, p.uid, 'POST', { type: 'counter', startAt: day(13), durationMin: 60, onSite: true }, { id: b.id })).status).toBe(200)
  const kept = await newBooking(p.serviceId)
  expect((await call(answer.POST, p.uid, 'POST', { type: 'accept' }, { id: kept.id })).status).toBe(200)
  const req = await newRequest(p.id) // after the bookings: relaxLimits withdraws the customer's open requests
  const quote = await (await call(quotesRoute.POST, p.uid, 'POST', { amount: 100, scope: 'Hall' }, { id: req.id })).json()
  await pool.query('UPDATE providers SET payouts_ready_at = NULL WHERE id = $1', [p.id])
  const q = await call(acceptQuoteRoute.POST, U.c1, 'POST', proposal, { id: quote.id })
  expect(q.status).toBe(409)
  expect((await q.json()).error).toBe('PROVIDER_NOT_READY')
  const c = await call(answer.POST, U.c1, 'POST', { type: 'accept' }, { id: b.id })
  expect(c.status).toBe(409)
  expect((await c.json()).error).toBe('PROVIDER_NOT_READY')
  expect((await pool.query('SELECT status FROM bookings WHERE id = $1', [kept.id])).rows[0].status).toBe('awaiting-payment') // untouched
})

it('a customer cannot request or book an unready provider (409) but can watch it', async () => {
  const p = await provider()
  await relaxLimits(U.c1)
  const r = await call(requestsRoute.POST, U.c1, 'POST', { providerId: p.id, description: 'Paint the hall' })
  expect(r.status).toBe(409)
  expect((await r.json()).error).toBe('PROVIDER_NOT_READY')
  const b = await call(bookingsRoute.POST, U.c1, 'POST', { ...proposal, serviceId: p.serviceId })
  expect(b.status).toBe(409)
  expect((await b.json()).error).toBe('PROVIDER_NOT_READY')
  expect((await watch(p.slug, U.c1)).status).toBe(204)
  expect((await watch(p.slug, U.c1)).status).toBe(204) // idempotent
  expect((await pool.query('SELECT count(*)::int n FROM availability_watches WHERE provider_id = $1', [p.id])).rows[0].n).toBe(1)
  expect((await watch(p.slug, p.uid)).status).toBe(400) // not one's own profile
  expect((await watch('no-such-slug', U.c1)).status).toBe(404)
  expect((await unwatch(p.slug, U.c1)).status).toBe(204)
  expect((await unwatch(p.slug, U.c1)).status).toBe(204)
  expect((await pool.query('SELECT count(*)::int n FROM availability_watches WHERE provider_id = $1', [p.id])).rows[0].n).toBe(0)
  await ready(p.id)
  const bookable = await watch(p.slug, U.c1)
  expect(bookable.status).toBe(409)
  expect((await bookable.json()).error).toBe('ALREADY_BOOKABLE')
})

it('three watches send the provider one customers-waiting notice with count 3 within 24 hours: the first tap at once, the cron a summary', async () => {
  const p = await provider()
  expect((await watch(p.slug, U.c1)).status).toBe(204)
  expect(await kindsFor(p.uid, 'customers-waiting')).toEqual([{ payload: { count: 1 } }]) // at once, the count only
  let mails = outboxForTests().filter((m) => m.to === EMAIL(p.uid))
  expect(mails).toHaveLength(1)
  expect(mails[0]!.text).toContain(': 1.')
  for (const c of [U.c2, U.c3]) expect((await watch(p.slug, c)).status).toBe(204) // within 24 hours: silent
  expect(await kindsFor(p.uid, 'customers-waiting')).toHaveLength(1)
  const now = new Date()
  await runDueTimers(db, new Date(now.getTime() + 19 * HOUR)) // too soon even with the cron's 4-hour tolerance
  expect(await kindsFor(p.uid, 'customers-waiting')).toHaveLength(1)
  await runDueTimers(db, new Date(now.getTime() + 21 * HOUR)) // next day's cron (a little early): one summary with the new count
  expect((await kindsFor(p.uid, 'customers-waiting')).map((r) => r.payload)).toEqual([{ count: 1 }, { count: 3 }])
  mails = outboxForTests().filter((m) => m.to === EMAIL(p.uid))
  expect(mails).toHaveLength(2)
  expect(mails[1]!.text).toContain(': 3.')
  for (const m of mails) for (const c of [U.c1, U.c2, U.c3]) expect(m.text + m.subject).not.toContain(c) // never who
  await runDueTimers(db, new Date(now.getTime() + 50 * HOUR)) // no new watchers since: nothing
  expect(await kindsFor(p.uid, 'customers-waiting')).toHaveLength(2)
})

it('two first taps at the same instant send one notice (the lock serialises them)', async () => {
  const p = await provider()
  const holder = await pool.connect() // someone else holds the notice lock: both taps must wait for it
  await holder.query('BEGIN')
  await holder.query("SELECT pg_advisory_xact_lock(hashtext('customers_waiting'))")
  let finished = 0
  const taps = Promise.all([watch(p.slug, U.c1), watch(p.slug, U.c2)].map((t) => t.then((r) => (finished++, r.status))))
  await new Promise((r) => setTimeout(r, 500))
  expect(finished).toBe(0) // without the lock they would be done by now
  await holder.query('COMMIT')
  holder.release()
  expect(await taps).toEqual([204, 204])
  expect(await kindsFor(p.uid, 'customers-waiting')).toHaveLength(1)
  expect(outboxForTests().filter((m) => m.to === EMAIL(p.uid))).toHaveLength(1)
})

it('no notice and no email when nobody is waiting (count 0), nor for an unpublished or suspended provider', async () => {
  const p = await provider()
  await watch(p.slug, U.c1)
  await pool.query("UPDATE notifications SET created_at = now() - interval '3 days' WHERE user_id = $1", [p.uid])
  await pool.query("UPDATE availability_watches SET notified_at = now(), created_at = now() WHERE provider_id = $1", [p.id]) // already told: 0 waiting
  await runDueTimers(db, new Date(Date.now() + HOUR))
  expect(await kindsFor(p.uid, 'customers-waiting')).toHaveLength(1)
  clearOutbox()
  await notifyBookingEvent('customers-waiting', p.uid, { count: '0' })
  await notifyBookingEvent('customers-waiting', p.uid, {})
  expect(outboxForTests()).toHaveLength(0)
  for (const hide of ["status = 'draft'", "suspended_until = now() + interval '1 day'"]) {
    const q = await provider()
    await watch(q.slug, U.c1)
    await pool.query("UPDATE notifications SET created_at = now() - interval '3 days' WHERE user_id = $1", [q.uid])
    await pool.query("UPDATE availability_watches SET created_at = now() WHERE provider_id = $1", [q.id])
    await pool.query(`UPDATE providers SET ${hide} WHERE id = $1`, [q.id])
    await runDueTimers(db, new Date(Date.now() + HOUR))
    expect(await kindsFor(q.uid, 'customers-waiting')).toHaveLength(1) // only the first tap's
  }
})

it('a blocked customer cannot watch (404); a watch already answered is re-armed by a new tap', async () => {
  const p = await provider()
  await pool.query('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)', [p.uid, U.c3])
  expect((await watch(p.slug, U.c3)).status).toBe(404)
  await pool.query('DELETE FROM blocks WHERE blocker_id = $1', [p.uid])
  await pool.query("DELETE FROM notifications WHERE user_id = $1 AND kind = 'provider-available'", [U.c1]) // count this test's only
  await watch(p.slug, U.c1)
  await startSetup(p.uid)
  const acct = (await prow(p.id)).stripe_account_id as string
  g.ready.add(acct)
  await refreshAccount(db, acct)
  expect(await kindsFor(U.c1, 'provider-available')).toHaveLength(1)
  g.ready.delete(acct) // the account is restricted again
  await refreshAccount(db, acct)
  await pool.query("UPDATE notifications SET created_at = now() - interval '2 days' WHERE user_id = $1", [p.uid])
  expect((await watch(p.slug, U.c1)).status).toBe(204)
  const w = (await pool.query('SELECT notified_at, created_at FROM availability_watches WHERE provider_id = $1', [p.id])).rows[0]
  expect(w.notified_at).toBeNull()
  expect((await kindsFor(p.uid, 'customers-waiting')).at(-1)!.payload).toEqual({ count: 1 }) // the re-armed watch counts again
  g.ready.add(acct)
  await refreshAccount(db, acct)
  expect(await kindsFor(U.c1, 'provider-available')).toHaveLength(2)
})

it('when the account becomes ready each watcher gets provider-available once', async () => {
  const p = await provider()
  for (const c of [U.c1, U.c2]) await watch(p.slug, c)
  await startSetup(p.uid)
  const acct = (await prow(p.id)).stripe_account_id as string
  g.ready.add(acct)
  await Promise.all([refreshAccount(db, acct), refreshAccount(db, acct), getStatus(p.uid), deliver(acct)])
  await refreshAccount(db, acct)
  for (const c of [U.c1, U.c2]) {
    const notes = (await kindsFor(c, 'provider-available')).filter((r) => r.payload.url.endsWith(`/providers/${p.slug}`)) // this provider's (earlier tests told c1 of others)
    expect(notes).toHaveLength(1)
    expect(notes[0].payload.url).toMatch(new RegExp(`/providers/${p.slug}$`))
    expect(outboxForTests().filter((m) => m.to === EMAIL(c))).toHaveLength(1)
  }
  expect((await kindsFor(U.c3, 'provider-available')).filter((r) => r.payload.url.endsWith(`/providers/${p.slug}`))).toHaveLength(0)
  expect(await kindsFor(p.uid, 'payout-setup-complete')).toHaveLength(1)
  expect((await pool.query('SELECT count(*)::int n FROM availability_watches WHERE provider_id = $1 AND notified_at IS NULL', [p.id])).rows[0].n).toBe(0)
})

it('the account-updated webhook event is handled through handleGatewayEvent; not ready clears the mark', async () => {
  const p = await provider()
  await startSetup(p.uid)
  const acct = (await prow(p.id)).stripe_account_id as string
  g.ready.add(acct)
  expect((await deliver(acct)).status).toBe(200)
  expect((await prow(p.id)).payouts_ready_at).not.toBeNull()
  g.ready.delete(acct)
  expect((await deliver(acct)).status).toBe(200)
  expect((await prow(p.id)).payouts_ready_at).toBeNull()
  expect(await profile(p.slug)).toMatchObject({ verified: false, canBook: false })
  expect(await kindsFor(p.uid, 'payout-setup-complete')).toHaveLength(1) // no notice for the change to not ready
  expect((await deliver('acct_unknown')).status).toBe(200) // an account we do not know changes nothing
})

it('with payments off every provider can quote and verified is false', async () => {
  const p = await provider()
  vi.stubEnv('PAYMENTS_ENABLED', 'false')
  expect(await profile(p.slug)).toMatchObject({ verified: false, canBook: true })
  const req = await newRequest(p.id)
  expect((await call(quotesRoute.POST, p.uid, 'POST', { amount: 100, scope: 'Hall' }, { id: req.id })).status).toBe(201)
  await ready(p.id)
  expect(await profile(p.slug)).toMatchObject({ verified: false, canBook: true }) // the mark means nothing while payments are off
})

it('the public DTO never exposes stripe ids or timestamps', async () => {
  const p = await provider()
  await startSetup(p.uid)
  g.ready.add((await prow(p.id)).stripe_account_id)
  await getStatus(p.uid)
  const raw = await (await call(profileRoute.GET, U.third, 'GET', undefined, { slug: p.slug })).text()
  expect(raw).not.toMatch(/acct_|stripe|payouts|readyAt/i)
  expect(JSON.parse(raw)).toMatchObject({ verified: true, canBook: true })
})

it('payout routes: signed out 401, no profile 409, payments off 503 PAYMENTS_OFF; notify-me signed out 401', async () => {
  for (const r of [await startSetup(U.third), await getStatus(U.third)]) expect(r.status).toBe(409)
  const anon = (h: (r: Request, c: { params: Promise<Record<string, string>> }) => Promise<Response>, method: string) =>
    h(new Request('http://localhost/app-api/v1/x', { method }), { params: Promise.resolve({ slug: 'x' }) })
  for (const r of [await anon(setup.POST, 'POST'), await anon(status.GET, 'GET'), await anon(notifyMe.POST, 'POST'), await anon(notifyMe.DELETE, 'DELETE')]) expect(r.status).toBe(401)
  vi.stubEnv('PAYMENTS_ENABLED', 'false')
  const p = await provider()
  for (const r of [await startSetup(p.uid), await getStatus(p.uid)]) {
    expect(r.status).toBe(503)
    expect((await r.json()).error).toBe('PAYMENTS_OFF')
  }
})

it('the data export lists the customer own watches by provider name only', async () => {
  const p = await provider()
  await watch(p.slug, U.c2)
  const body = await (await call(exportRoute.GET, U.c2)).json()
  expect(body.watches).toContainEqual({ provider: `Po Prov ${p.uid.slice(4)}`, slug: p.slug, createdAt: expect.any(String), notified: false })
  expect(JSON.stringify(body.watches)).not.toContain(p.id)
  const theirs = await (await call(exportRoute.GET, p.uid)).json()
  expect(theirs.watches).toEqual([]) // the provider never sees who watches them
})
