import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { db, pool } from '@kando/db'
import { PayLinkSchema } from '@kando/contract'
import { AmountTooSmallError, clearOutbox, COMMISSION_RATE, createPayLink, handleGatewayEvent, outboxForTests, runDueTimers, setGatewayForTests, type GatewayEvent } from '@kando/domain'
import { call, cleanupUsers, EMAIL, relaxLimits, seedBase, seedProvider, seedUser } from './helpers'
import { fakeGateway, type FakeGateway } from './fake-gateway'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const pay = await import('../app/app-api/v1/bookings/[id]/pay/route')
const webhook = await import('../app/api/stripe/webhook/route')
const bookingsRoute = await import('../app/app-api/v1/bookings/route')
const answer = await import('../app/app-api/v1/bookings/[id]/answer/route')
const busyRoute = await import('../app/app-api/v1/providers/[slug]/busy/route')
const withdrawRoute = await import('../app/app-api/v1/bookings/[id]/withdraw/route')

const U = { cust: 'py-cust', cust2: 'py-cust2', owner: 'py-owner', third: 'py-third', gone: 'py-gone' }
const HOUR = 3_600_000
const DAY = 24 * HOUR
let providerId: string, serviceId: string
let g: FakeGateway
let slot = 0 // every booking gets its own start time unless a test wants an overlap

beforeAll(async () => {
  await cleanupUsers()
  const { categoryId } = await seedBase()
  for (const u of [U.cust, U.cust2, U.third]) await seedUser(u)
  providerId = await seedProvider(U.owner, { name: 'Py Owner', categoryId, price: 100 })
  serviceId = (await pool.query('SELECT id FROM services WHERE provider_id = $1', [providerId])).rows[0].id
  await pool.query('UPDATE providers SET payouts_ready_at = now() WHERE id = $1', [providerId]) // payout set-up done: with payments on only such a provider accepts (payouts.int.spec.ts)
})
beforeEach(() => {
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

const nextStart = () => new Date(Date.now() + 10 * DAY + ++slot * 3 * HOUR)
/** A booking as an accepted proposal leaves it (owner connection): awaiting-payment with a deadline. */
async function awaiting(o: { payBy?: Date; startAt?: Date; customer?: string; status?: string; provider?: string; service?: string } = {}): Promise<{ id: string; startAt: Date }> {
  const startAt = o.startAt ?? nextStart()
  const payBy = o.payBy ?? new Date(Date.now() + 40 * HOUR)
  const id = (
    await pool.query(
      `INSERT INTO bookings (customer_id, provider_id, service_id, source, status, start_at, duration_min, pay_by, accepted_at)
       VALUES ($1, $2, $3, 'direct', $4, $5, 60, $6, $6::timestamptz - interval '1 hour') RETURNING id`,
      [o.customer ?? U.cust, o.provider ?? providerId, o.service ?? serviceId, o.status ?? 'awaiting-payment', startAt, payBy],
    )
  ).rows[0].id as string
  return { id, startAt }
}
const row = async (id: string) => (await pool.query('SELECT status, paid_at, payment_ref, commission_rate, checkout_ref FROM bookings WHERE id = $1', [id])).rows[0]
const ledger = async (id: string) => (await pool.query('SELECT kind, amount, provider_id, gateway_ref, idempotency_key FROM ledger_entries WHERE booking_id = $1 ORDER BY kind, created_at', [id])).rows
const payLink = (id: string, as = U.cust) => call(pay.POST, as, 'POST', undefined, { id })
const paid = (bookingId: string, o: Partial<Extract<GatewayEvent, { type: 'checkout-paid' }>> = {}): GatewayEvent => ({
  id: `evt_${randomUUID()}`,
  type: 'checkout-paid',
  bookingId,
  providerId,
  customerId: U.cust,
  sessionId: `cs_${randomUUID()}`,
  paymentRef: `pi_${randomUUID()}`,
  amountCents: 10_000,
  currency: 'EUR',
  ...o,
})
const deliver = (e: GatewayEvent, signature?: string) => {
  const signed = g.event(e)
  return webhook.POST(new Request('http://localhost/api/stripe/webhook', { method: 'POST', body: signed.body, headers: { 'stripe-signature': signature ?? signed.signature } }))
}
const callsOf = (method: string) => g.calls.filter((c) => c.method === method).map((c) => c.args as Record<string, unknown>)
const eventRows = async (id: string) => (await pool.query('SELECT count(*)::int n FROM stripe_events WHERE id = $1', [id])).rows[0].n as number
const notes = async (bookingId: string) => (await pool.query("SELECT user_id, kind FROM notifications WHERE payload->>'bookingId' = $1 ORDER BY kind", [bookingId])).rows
const flags = async (kind: string, refId: string) => (await pool.query('SELECT ref_id, user_id, note FROM staff_flags WHERE kind = $1 AND ref_id = $2', [kind, refId])).rows

it('the customer gets a pay link; the provider and a third user get 404', async () => {
  const b = await awaiting()
  for (const as of [U.owner, U.third]) expect((await payLink(b.id, as)).status).toBe(404)
  expect((await payLink('not-a-uuid')).status).toBe(404)
  const res = await payLink(b.id)
  expect(res.status).toBe(200)
  const { url } = PayLinkSchema.parse(await res.json())
  const [args] = callsOf('createCheckout')
  expect(url).toBe('https://stripe.fake/pay/cs_fake_1')
  // the amount is the booking's (from the service, read on the owner connection), never the client's
  expect(args).toMatchObject({ bookingId: b.id, providerId, customerId: U.cust, amountCents: 10_000, currency: 'EUR' })
  expect(args!.successUrl).toMatch(/\/payment-done$/)
  expect(String(args!.successUrl)).not.toContain(b.id) // nothing of the booking in the return address
  expect((await row(b.id)).checkout_ref).toContain('cs_fake_1') // stored on the owner connection (staff-only column)
})

it('no pay link before acceptance or after payBy (409)', async () => {
  const proposed = await awaiting({ status: 'proposed', payBy: undefined })
  await pool.query('UPDATE bookings SET pay_by = NULL, accepted_at = NULL WHERE id = $1', [proposed.id])
  const lapsed = await awaiting({ payBy: new Date(Date.now() - 60_000) })
  const withdrawn = await awaiting({ status: 'withdrawn' })
  for (const b of [proposed, lapsed, withdrawn]) {
    const res = await payLink(b.id)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('not-open')
  }
  expect(g.attempts.createCheckout ?? 0).toBe(0)
})

it('a second tap reuses the same session', async () => {
  const b = await awaiting()
  const first = PayLinkSchema.parse(await (await payLink(b.id)).json())
  const second = PayLinkSchema.parse(await (await payLink(b.id)).json())
  expect(second.url).toBe(first.url)
  expect(g.attempts.createCheckout).toBe(1) // the stored session is reused: no second call at all
  // once that session has expired, the next tap gets a new one with a new key (Stripe refuses a reused key with new parameters)
  const { expiresAt } = JSON.parse((await row(b.id)).checkout_ref)
  const third = await createPayLink(db, U.cust, b.id, new Date(new Date(expiresAt).getTime() + 1000))
  expect(third.url).not.toBe(first.url)
  expect(new Set(callsOf('createCheckout').map((a) => a.idempotencyKey)).size).toBe(2)
})

it('the session expiry is computed once, lies 30 minutes to 24 hours ahead and never outlives payBy; under 31 minutes left is 409 PAY_WINDOW_TOO_SHORT', async () => {
  const now = new Date()
  const near = await awaiting({ payBy: new Date(now.getTime() + 2 * HOUR) })
  await createPayLink(db, U.cust, near.id, now)
  expect(callsOf('createCheckout')[0]!.expiresAt).toEqual(new Date(now.getTime() + 2 * HOUR)) // the deadline itself
  const far = await awaiting({ payBy: new Date(now.getTime() + 47 * HOUR) })
  await createPayLink(db, U.cust, far.id, now)
  const exp = (callsOf('createCheckout')[1]!.expiresAt as Date).getTime()
  expect(exp - now.getTime()).toBeGreaterThanOrEqual(31 * 60_000)
  expect(exp - now.getTime()).toBeLessThanOrEqual(24 * HOUR)
  expect((now.getTime() + 47 * HOUR - exp) % (23 * HOUR)).toBe(0) // fixed steps back from payBy: a retry a minute later gets the same expiry and key
  g.forgetKeys()
  await pool.query('UPDATE bookings SET checkout_ref = NULL WHERE id = $1', [far.id]) // as if the process died before storing it
  await createPayLink(db, U.cust, far.id, new Date(now.getTime() + 60_000))
  expect(callsOf('createCheckout')[2]).toEqual(callsOf('createCheckout')[1]) // same parameters, same key: Stripe replays the session
  const tight = await awaiting({ payBy: new Date(now.getTime() + 20 * 60_000) })
  const res = await payLink(tight.id)
  expect(res.status).toBe(409)
  expect((await res.json()).error).toBe('PAY_WINDOW_TOO_SHORT')
})

it('an amount under the Stripe minimum is 409 AMOUNT_TOO_SMALL without a gateway call; a gateway amount-too-small gives the same', async () => {
  const tiny = await awaiting()
  await pool.query('UPDATE bookings SET amount = 0.40 WHERE id = $1', [tiny.id])
  const res = await payLink(tiny.id)
  expect(res.status).toBe(409)
  expect((await res.json()).error).toBe('AMOUNT_TOO_SMALL')
  expect(g.attempts.createCheckout ?? 0).toBe(0)
  const other = await awaiting()
  g.createCheckout = async () => {
    throw new AmountTooSmallError('amount_too_small')
  }
  const res2 = await payLink(other.id)
  expect(res2.status).toBe(409)
  expect((await res2.json()).error).toBe('AMOUNT_TOO_SMALL')
})

it('a booking further ahead than the hold limit cannot be paid', async () => {
  const b = await awaiting({ startAt: new Date(Date.now() + 61 * DAY) }) // accepted while payments were off
  const res = await payLink(b.id)
  expect(res.status).toBe(400)
  expect((await res.json()).error).toBe('TOO_FAR_AHEAD')
  expect(g.attempts.createCheckout ?? 0).toBe(0)
})

it('a booking further ahead than 60 days cannot be proposed or accepted while payments are on', async () => {
  await relaxLimits(U.cust2)
  const body = (days: number) => ({ serviceId, startAt: new Date(Date.now() + days * DAY).toISOString(), durationMin: 60, onSite: true, address: { postcode: '10115' } })
  const res = await call(bookingsRoute.POST, U.cust2, 'POST', body(61))
  expect(res.status).toBe(400)
  expect((await res.json()).error).toBe('TOO_FAR_AHEAD')
  // proposed while payments were off: the provider cannot accept it now
  vi.stubEnv('PAYMENTS_ENABLED', 'false')
  const made = await call(bookingsRoute.POST, U.cust2, 'POST', body(61))
  expect(made.status).toBe(201)
  vi.stubEnv('PAYMENTS_ENABLED', 'true')
  const acc = await call(answer.POST, U.owner, 'POST', { type: 'accept' }, { id: (await made.json()).id })
  expect(acc.status).toBe(400)
  expect((await acc.json()).error).toBe('TOO_FAR_AHEAD')
  expect((await call(bookingsRoute.POST, U.cust2, 'POST', body(59))).status).toBe(201)
})

it('the pay link is refused while another booking holds the time', async () => {
  const b = await awaiting()
  await awaiting({ startAt: b.startAt, customer: U.cust2, status: 'confirmed' })
  const res = await payLink(b.id)
  expect(res.status).toBe(409)
  expect((await res.json()).error).toBe('slot-pending')
})

it('a paid event confirms the booking, stores the commission rate and writes one charge row', async () => {
  const b = await awaiting()
  const e = paid(b.id)
  const res = await deliver(e)
  expect(res.status).toBe(200)
  expect(await row(b.id)).toMatchObject({ status: 'confirmed', payment_ref: (e as { paymentRef: string }).paymentRef, commission_rate: COMMISSION_RATE.toFixed(4) })
  expect((await row(b.id)).paid_at).not.toBeNull()
  expect(await ledger(b.id)).toEqual([{ kind: 'charge', amount: '100.00', provider_id: providerId, gateway_ref: (e as { paymentRef: string }).paymentRef, idempotency_key: `charge:${(e as { paymentRef: string }).paymentRef}` }])
  expect(g.calls).toEqual([]) // no refund
  expect(await notes(b.id)).toEqual([
    { user_id: U.owner, kind: 'booking-paid' },
    { user_id: U.cust, kind: 'payment-received' },
  ])
  const mails = outboxForTests()
  expect(mails.map((m) => m.to).sort()).toEqual([EMAIL(U.cust), EMAIL(U.owner)].sort())
  for (const m of mails) expect(m.text).not.toMatch(/treuhand|escrow|garantie/i)
  expect(mails.find((m) => m.to === EMAIL(U.cust))!.text).toContain('erst an den Anbieter ausgezahlt')
})

it('confirmation is one transaction: a failure after the booking update leaves nothing behind', async () => {
  const b = await awaiting()
  await pool.query("CREATE FUNCTION pay_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'crash'; END $$")
  await pool.query('CREATE TRIGGER pay_test_fail BEFORE INSERT ON ledger_entries FOR EACH ROW EXECUTE FUNCTION pay_test_fail()')
  const e = paid(b.id)
  try {
    expect((await deliver(e)).status).toBe(500) // Stripe retries
  } finally {
    await pool.query('DROP TRIGGER pay_test_fail ON ledger_entries')
    await pool.query('DROP FUNCTION pay_test_fail()')
  }
  expect(await row(b.id)).toMatchObject({ status: 'awaiting-payment', paid_at: null, payment_ref: null, commission_rate: null })
  expect(await ledger(b.id)).toEqual([])
  expect(await eventRows(e.id)).toBe(0)
  expect(await notes(b.id)).toEqual([])
  // the retry goes through
  expect((await deliver(e)).status).toBe(200)
  expect((await row(b.id)).status).toBe('confirmed')
})

it('the same event twice is processed once', async () => {
  const b = await awaiting()
  const e = paid(b.id)
  expect((await deliver(e)).status).toBe(200)
  expect((await deliver(e)).status).toBe(200)
  expect(await ledger(b.id)).toHaveLength(1)
  expect(await eventRows(e.id)).toBe(1)
  expect(await notes(b.id)).toHaveLength(2)
  // a second event for the same payment (another event id) changes nothing either: no refund of the booking's own payment
  expect((await deliver({ ...e, id: `evt_${randomUUID()}` })).status).toBe(200)
  expect(await ledger(b.id)).toHaveLength(1)
  expect(g.calls).toEqual([])
})

it('a bad signature is 400 and changes nothing', async () => {
  const b = await awaiting()
  const e = paid(b.id)
  expect((await deliver(e, 'forged')).status).toBe(400)
  const missing = await webhook.POST(new Request('http://localhost/api/stripe/webhook', { method: 'POST', body: JSON.stringify(e) }))
  expect(missing.status).toBe(400)
  expect((await row(b.id)).status).toBe('awaiting-payment')
  expect(await ledger(b.id)).toEqual([])
  expect(await eventRows(e.id)).toBe(0)
  const big = await webhook.POST(new Request('http://localhost/api/stripe/webhook', { method: 'POST', body: 'x'.repeat(600_000), headers: { 'stripe-signature': 'x' } }))
  expect(big.status).toBe(413)
})

it('a late payment is refunded and the booking stays expired', async () => {
  const b = await awaiting({ payBy: new Date(Date.now() - HOUR) })
  await runDueTimers(db, new Date())
  expect((await row(b.id)).status).toBe('expired')
  const e = paid(b.id) as Extract<GatewayEvent, { type: 'checkout-paid' }>
  expect((await deliver(e)).status).toBe(200)
  expect(await row(b.id)).toMatchObject({ status: 'expired', paid_at: null, payment_ref: null })
  const key = `refund:late:${b.id}:${e.paymentRef}`
  expect(callsOf('refund')).toEqual([{ paymentRef: e.paymentRef, amountCents: 10_000, bookingId: b.id, idempotencyKey: key }])
  expect((await ledger(b.id)).map((r) => [r.kind, r.amount, r.idempotency_key])).toEqual([
    ['charge', '100.00', `charge:${e.paymentRef}`],
    ['refund', '100.00', key],
  ])
  expect((await notes(b.id)).filter((n) => n.kind === 'payment-late-refunded')).toEqual([{ user_id: U.cust, kind: 'payment-late-refunded' }])
  // withdrawn or declined: the same
  for (const status of ['withdrawn', 'declined']) {
    const w = await awaiting({ status })
    expect((await deliver(paid(w.id))).status).toBe(200)
    expect((await row(w.id)).status).toBe(status)
    expect((await ledger(w.id)).map((r) => r.kind)).toEqual(['charge', 'refund'])
  }
})

it('a payment within 10 minutes after payBy still confirms; later, or a different amount, is refunded', async () => {
  const now = new Date()
  const inGrace = await awaiting({ payBy: new Date(now.getTime() - 9 * 60_000) })
  await handleGatewayEvent(paid(inGrace.id), now)
  expect((await row(inGrace.id)).status).toBe('confirmed')
  const tooLate = await awaiting({ payBy: new Date(now.getTime() - 11 * 60_000) })
  await handleGatewayEvent(paid(tooLate.id), now)
  expect((await row(tooLate.id)).status).toBe('awaiting-payment')
  const wrong = await awaiting()
  await handleGatewayEvent(paid(wrong.id, { amountCents: 9_999 }), now)
  expect((await row(wrong.id)).status).toBe('awaiting-payment')
  expect(callsOf('refund').map((r) => [r.bookingId, r.amountCents])).toEqual([
    [tooLate.id, 10_000],
    [wrong.id, 9_999],
  ])
})

it('a failed refund call answers 500 and records nothing; the retry refunds once', async () => {
  const b = await awaiting({ status: 'expired' })
  const e = paid(b.id)
  const refund = g.refund
  g.refund = async () => {
    throw new Error('gateway down')
  }
  expect((await deliver(e)).status).toBe(500)
  expect(await ledger(b.id)).toEqual([])
  expect(await eventRows(e.id)).toBe(0) // not marked processed: the refund obligation is not lost
  g.refund = refund
  g.forgetKeys() // even after Stripe's key window
  expect((await deliver(e)).status).toBe(200)
  expect(callsOf('refund')).toHaveLength(1)
  expect((await ledger(b.id)).map((r) => r.kind)).toEqual(['charge', 'refund'])
})

it('a payment for a booking deleted with the account is refunded with the ledger row carrying the metadata providerId', async () => {
  await seedUser(U.gone)
  const b = await awaiting({ customer: U.gone })
  await pool.query('DELETE FROM users WHERE id = $1', [U.gone]) // the booking goes with the account
  expect(await row(b.id)).toBeUndefined()
  const e = paid(b.id, { customerId: U.gone }) as Extract<GatewayEvent, { type: 'checkout-paid' }>
  expect((await deliver(e)).status).toBe(200)
  expect(callsOf('refund')).toMatchObject([{ paymentRef: e.paymentRef, amountCents: 10_000, bookingId: b.id }])
  expect((await ledger(b.id)).map((r) => [r.kind, r.provider_id])).toEqual([
    ['charge', providerId],
    ['refund', providerId],
  ])
  // the provider's account was deleted instead: the customer still exists and is told
  const other = await awaiting({ customer: U.cust2 })
  await pool.query('DELETE FROM bookings WHERE id = $1', [other.id])
  expect((await deliver(paid(other.id, { customerId: U.cust2 }))).status).toBe(200)
  expect((await pool.query("SELECT count(*)::int n FROM notifications WHERE user_id = $1 AND kind = 'payment-late-refunded'", [U.cust2])).rows[0].n).toBe(1)
})

it('a duplicate payment after confirmation is refunded', async () => {
  const b = await awaiting()
  const first = paid(b.id) as Extract<GatewayEvent, { type: 'checkout-paid' }>
  const second = paid(b.id) as Extract<GatewayEvent, { type: 'checkout-paid' }>
  await deliver(first)
  expect((await deliver(second)).status).toBe(200)
  expect(await row(b.id)).toMatchObject({ status: 'confirmed', payment_ref: first.paymentRef })
  expect(callsOf('refund')).toMatchObject([{ paymentRef: second.paymentRef, amountCents: 10_000 }])
  expect((await ledger(b.id)).map((r) => [r.kind, r.gateway_ref === second.paymentRef || r.kind === 'refund'])).toEqual([
    ['charge', false],
    ['charge', true],
    ['refund', true],
  ])
})

it('two concurrent pay events for the same booking: exactly one confirms and the other is refunded', async () => {
  const b = await awaiting()
  const [e1, e2] = [paid(b.id), paid(b.id)] as Extract<GatewayEvent, { type: 'checkout-paid' }>[]
  // hold the provider's slot lock: both events must wait for it (proves they take it), then exactly one wins
  const holder = await pool.connect()
  let both: Promise<Response[]>
  try {
    await holder.query('BEGIN')
    await holder.query("SELECT pg_advisory_xact_lock(hashtext('booking_slot'), hashtext($1))", [providerId])
    both = Promise.all([deliver(e1!), deliver(e2!)])
    await new Promise((ok) => setTimeout(ok, 500))
    expect((await row(b.id)).status).toBe('awaiting-payment')
    expect(await ledger(b.id)).toEqual([])
    await holder.query('COMMIT')
  } finally {
    holder.release()
  }
  expect((await both).map((r) => r.status)).toEqual([200, 200])
  const r = await row(b.id)
  expect(r.status).toBe('confirmed')
  expect([e1!.paymentRef, e2!.paymentRef]).toContain(r.payment_ref)
  expect(callsOf('refund')).toMatchObject([{ paymentRef: r.payment_ref === e1!.paymentRef ? e2!.paymentRef : e1!.paymentRef }])
  expect((await ledger(b.id)).map((x) => x.kind)).toEqual(['charge', 'charge', 'refund'])
})

it('a payment and a provider accept of an overlapping booking take the provider lock in turn: never both', async () => {
  // A's deadline passed a minute ago (in the grace, the sweep has not run), so the provider may accept B for the same time
  const a = await awaiting({ payBy: new Date(Date.now() - 60_000) })
  await relaxLimits(U.cust2)
  const made = await call(bookingsRoute.POST, U.cust2, 'POST', { serviceId, startAt: a.startAt.toISOString(), durationMin: 60, onSite: true, address: { postcode: '10115' } })
  const bId = (await made.json()).id as string
  const holder = await pool.connect()
  let both: Promise<[Response, Response]>
  try {
    await holder.query('BEGIN')
    await holder.query("SELECT pg_advisory_xact_lock(hashtext('booking_slot'), hashtext($1))", [providerId])
    both = Promise.all([deliver(paid(a.id)), call(answer.POST, U.owner, 'POST', { type: 'accept' }, { id: bId })])
    await new Promise((ok) => setTimeout(ok, 500))
    await holder.query('COMMIT')
  } finally {
    holder.release()
  }
  const [hook, acc] = await both
  expect(hook.status).toBe(200)
  const aStatus = (await row(a.id)).status
  const bStatus = (await row(bId)).status
  if (aStatus === 'confirmed') {
    expect(acc.status).toBe(409) // the confirmed booking holds the time
    expect(bStatus).toBe('proposed')
    expect(callsOf('refund')).toEqual([])
  } else {
    expect(acc.status).toBe(200)
    expect(bStatus).toBe('awaiting-payment')
    expect(callsOf('refund')).toHaveLength(1) // the payment lost the time: refunded
  }
})

it('a confirmed booking blocks the time and shows as booked', async () => {
  const b = await awaiting()
  await deliver(paid(b.id))
  const from = new Date(b.startAt.getTime() - HOUR).toISOString()
  const to = new Date(b.startAt.getTime() + 2 * HOUR).toISOString()
  const res = await busyRoute.GET(new Request(`http://localhost/x?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`), { params: Promise.resolve({ slug: `${U.owner}-slug` }) })
  expect((await res.json()).docs).toEqual([{ startAt: b.startAt.toISOString(), endAt: new Date(b.startAt.getTime() + HOUR).toISOString(), state: 'booked' }])
  await relaxLimits(U.cust2)
  const made = await call(bookingsRoute.POST, U.cust2, 'POST', { serviceId, startAt: b.startAt.toISOString(), durationMin: 60, onSite: true, address: { postcode: '10115' } })
  const acc = await call(answer.POST, U.owner, 'POST', { type: 'accept' }, { id: (await made.json()).id })
  expect(acc.status).toBe(409)
  expect((await acc.json()).error).toBe('slot-pending')
})

it('the timers never expire confirmed bookings', async () => {
  const b = await awaiting({ payBy: new Date(Date.now() + HOUR) })
  await handleGatewayEvent(paid(b.id))
  await pool.query("UPDATE bookings SET pay_by = now() - interval '1 day', answer_by = now() - interval '1 day' WHERE id = $1", [b.id])
  await runDueTimers(db, new Date(Date.now() + 2 * DAY)) // past pay_by and answer_by, before the start (from 7 days after the end a silent booking goes to staff: finish.int.spec.ts)
  expect((await row(b.id)).status).toBe('confirmed')
  // far ahead: never expired; a silent booking is asked, then (24 hours later) goes to staff as disputed
  await runDueTimers(db, new Date(Date.now() + 30 * DAY))
  expect((await row(b.id)).status).toBe('confirmed')
  await runDueTimers(db, new Date(Date.now() + 31 * DAY))
  expect((await row(b.id)).status).toBe('disputed')
})

it('with PAYMENTS_ENABLED off the pay route is 503 PAYMENTS_OFF and the webhook 404', async () => {
  const b = await awaiting()
  vi.stubEnv('PAYMENTS_ENABLED', 'false')
  const res = await payLink(b.id)
  expect(res.status).toBe(503)
  expect((await res.json()).error).toBe('PAYMENTS_OFF')
  const hook = await webhook.POST(new Request('http://localhost/api/stripe/webhook', { method: 'POST', body: '{}', headers: { 'stripe-signature': 'x' } }))
  expect(hook.status).toBe(404)
  expect(g.calls).toEqual([])
})

it('charge-disputed creates one chargeback flag', async () => {
  const b = await awaiting()
  const e = paid(b.id) as Extract<GatewayEvent, { type: 'checkout-paid' }>
  await deliver(e)
  const dispute = { id: `evt_${randomUUID()}`, type: 'charge-disputed', paymentRef: e.paymentRef } as const
  expect((await deliver(dispute)).status).toBe(200)
  expect((await deliver({ ...dispute, id: `evt_${randomUUID()}` })).status).toBe(200) // a second dispute event: still one open flag
  expect(await flags('chargeback', b.id)).toEqual([{ ref_id: b.id, user_id: U.cust, note: expect.stringContaining(e.paymentRef) }])
  expect((await row(b.id)).status).toBe('confirmed')
})

it('refund-failed creates a flag', async () => {
  const b = await awaiting({ status: 'expired' })
  const e = paid(b.id) as Extract<GatewayEvent, { type: 'checkout-paid' }>
  await deliver(e)
  const failed = { id: `evt_${randomUUID()}`, type: 'refund-failed', paymentRef: e.paymentRef, refundId: 're_fake_1', bookingId: b.id } as const
  expect((await deliver(failed)).status).toBe(200)
  expect(await flags('refund-failed', b.id)).toEqual([{ ref_id: b.id, user_id: U.cust, note: expect.stringContaining('re_fake_1') }])
})

it('unknown events are ignored with 200 and not recorded', async () => {
  const e = { id: `evt_${randomUUID()}`, type: 'other' } as const
  expect((await deliver(e)).status).toBe(200)
  expect(await eventRows(e.id)).toBe(0)
})

it('a checkout-paid event that cannot be processed answers 500 and leaves exactly one payment-unprocessed flag', async () => {
  const b = await awaiting()
  const e = paid(b.id) as Extract<GatewayEvent, { type: 'checkout-paid' }>
  await pool.query("CREATE FUNCTION pay_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'crash'; END $$")
  await pool.query('CREATE TRIGGER pay_test_fail BEFORE INSERT ON stripe_events FOR EACH ROW EXECUTE FUNCTION pay_test_fail()')
  try {
    expect((await deliver(e)).status).toBe(500) // Stripe retries
    expect((await deliver(e)).status).toBe(500)
  } finally {
    await pool.query('DROP TRIGGER pay_test_fail ON stripe_events')
    await pool.query('DROP FUNCTION pay_test_fail()')
  }
  expect(await flags('payment-unprocessed', b.id)).toEqual([{ ref_id: b.id, user_id: null, note: expect.stringContaining(e.paymentRef) }])
  expect((await row(b.id)).status).toBe('awaiting-payment')
  await pool.query("DELETE FROM staff_flags WHERE kind = 'payment-unprocessed' AND ref_id = $1", [b.id])
})

it('refund done, then the commit fails: the retry makes no second refund and writes the rows once', async () => {
  const b = await awaiting({ status: 'expired' })
  const e = paid(b.id)
  await pool.query("CREATE FUNCTION pay_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind = 'refund' THEN RAISE EXCEPTION 'crash'; END IF; RETURN NEW; END $$")
  await pool.query('CREATE TRIGGER pay_test_fail BEFORE INSERT ON ledger_entries FOR EACH ROW EXECUTE FUNCTION pay_test_fail()')
  try {
    expect((await deliver(e)).status).toBe(500)
  } finally {
    await pool.query('DROP TRIGGER pay_test_fail ON ledger_entries')
    await pool.query('DROP FUNCTION pay_test_fail()')
  }
  expect(callsOf('refund')).toHaveLength(1) // the money went back already
  expect(await ledger(b.id)).toEqual([])
  expect(await eventRows(e.id)).toBe(0)
  g.forgetKeys() // even after the 24-hour key window: found by its metadata key
  expect((await deliver(e)).status).toBe(200)
  expect(callsOf('refund')).toHaveLength(1)
  expect((await ledger(b.id)).map((r) => r.kind)).toEqual(['charge', 'refund'])
  await pool.query("DELETE FROM staff_flags WHERE kind = 'payment-unprocessed' AND ref_id = $1", [b.id])
})

it('withdrawing a confirmed booking is 409', async () => {
  const b = await awaiting()
  await deliver(paid(b.id))
  const res = await call(withdrawRoute.POST, U.cust, 'POST', undefined, { id: b.id })
  expect(res.status).toBe(409)
  expect((await row(b.id)).status).toBe('confirmed')
})

it('the pay link is 409 provider-unavailable for an unpublished or suspended provider', async () => {
  const b = await awaiting()
  await pool.query("UPDATE providers SET status = 'draft' WHERE id = $1", [providerId])
  try {
    const res = await payLink(b.id)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('provider-unavailable')
  } finally {
    await pool.query("UPDATE providers SET status = 'published' WHERE id = $1", [providerId])
  }
  await pool.query("UPDATE providers SET suspended_until = now() + interval '1 day' WHERE id = $1", [providerId])
  try {
    expect((await payLink(b.id)).status).toBe(409)
  } finally {
    await pool.query('UPDATE providers SET suspended_until = NULL WHERE id = $1', [providerId])
  }
  expect(g.attempts.createCheckout ?? 0).toBe(0)
})

it('a stored session expiring within 5 minutes is not reused; a gateway RangeError near the edge is 409 PAY_WINDOW_TOO_SHORT', async () => {
  const now = new Date()
  const b = await awaiting({ payBy: new Date(now.getTime() + 40 * HOUR) })
  const first = await createPayLink(db, U.cust, b.id, now)
  const { expiresAt } = JSON.parse((await row(b.id)).checkout_ref)
  const late = await createPayLink(db, U.cust, b.id, new Date(new Date(expiresAt).getTime() - 4 * 60_000))
  expect(g.attempts.createCheckout).toBe(2)
  expect(late.url).not.toBe(first.url)
  const edge = await awaiting()
  g.createCheckout = async () => {
    throw new RangeError('Checkout expiresAt must be 30 minutes to 24 hours from now')
  }
  const res = await payLink(edge.id)
  expect(res.status).toBe(409)
  expect((await res.json()).error).toBe('PAY_WINDOW_TOO_SHORT')
})

it('a payment made just after the deadline is not lost to the sweep: the timers wait PAY_GRACE_MINUTES', async () => {
  const b = await awaiting({ payBy: new Date(Date.now() - 5 * 60_000) })
  await runDueTimers(db, new Date())
  expect((await row(b.id)).status).toBe('awaiting-payment')
  expect((await payLink(b.id)).status).toBe(409) // no new pay link after the deadline
  expect((await deliver(paid(b.id))).status).toBe(200)
  expect((await row(b.id)).status).toBe('confirmed')
})
