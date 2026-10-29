import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { db, pool } from '@kando/db'
import { deleteAccount, setGatewayForTests, settle } from '@kando/domain'
import { cleanupUsers, EMAIL, seedBase, seedProvider, seedUser } from './helpers'
import { fakeGateway, type FakeGateway } from './fake-gateway'

const U = { cust: 'st-cust', owner: 'st-owner', bare: 'st-bare' }
let providerId: string
let bareProviderId: string
let g: FakeGateway
let hour = 0

beforeAll(async () => {
  await cleanupUsers()
  const { categoryId } = await seedBase()
  await seedUser(U.cust)
  providerId = await seedProvider(U.owner, { name: 'St Owner', categoryId, price: 100 })
  bareProviderId = await seedProvider(U.bare, { name: 'St Bare', categoryId, price: 100 })
  await pool.query("UPDATE providers SET stripe_account_id = 'acct_st_1' WHERE id = $1", [providerId])
})
beforeEach(() => {
  vi.stubEnv('PAYMENTS_ENABLED', 'true')
  g = fakeGateway()
  setGatewayForTests(g)
})
afterEach(() => {
  setGatewayForTests(undefined)
  vi.unstubAllEnvs()
})
afterAll(cleanupUsers)

/** A paid (confirmed) booking with its charge row, as the payment webhook leaves it. */
async function paidBooking(o: { paid?: number; rate?: number; provider?: string } = {}): Promise<string> {
  const p = o.provider ?? providerId
  const service = (await pool.query('SELECT id FROM services WHERE provider_id = $1', [p])).rows[0].id
  const id = (
    await pool.query(
      `INSERT INTO bookings (customer_id, provider_id, service_id, source, status, start_at, duration_min, paid_at, payment_ref, commission_rate)
       VALUES ($1, $2, $3, 'direct', 'confirmed', now() + make_interval(hours => $4), 60, now(), 'pi_st', $5) RETURNING id`,
      [U.cust, p, service, 48 + ++hour * 2, o.rate ?? 0.12],
    )
  ).rows[0].id as string
  await pool.query("INSERT INTO ledger_entries (booking_id, provider_id, kind, amount, idempotency_key) VALUES ($1, $2, 'charge', $3, $4)", [id, p, o.paid ?? 100, `charge:${id}`])
  return id
}

const rows = async (id: string) =>
  Object.fromEntries((await pool.query("SELECT kind, amount, idempotency_key FROM ledger_entries WHERE booking_id = $1 AND kind <> 'charge'", [id])).rows.map((r) => [r.kind, { amount: r.amount, key: r.idempotency_key }]))
const releasedAt = async (id: string) => (await pool.query('SELECT released_at FROM bookings WHERE id = $1', [id])).rows[0].released_at
const callsOf = (method: string) => g.calls.filter((c) => c.method === method).map((c) => c.args)
/** The refusal a domain function throws (a JSON Response). */
const refusal = (p: Promise<unknown>) =>
  p.then(
    () => ({ status: 0, body: null }),
    async (e: unknown) => (e instanceof Response ? { status: e.status, body: await e.json() } : Promise.reject(e)),
  )

it('settle full: one transfer of amount minus commission, one commission row, no refund', async () => {
  const id = await paidBooking()
  expect(await settle(db, id, 100)).toEqual({ refunded: 0, transferred: 88, commission: 12 })
  expect(await rows(id)).toEqual({ transfer: { amount: '88.00', key: `transfer:${id}` }, commission: { amount: '12.00', key: `commission:${id}` } })
  expect(callsOf('refund')).toEqual([])
  expect(callsOf('transfer')).toEqual([{ accountId: 'acct_st_1', amountCents: 8800, currency: 'EUR', paymentRef: 'pi_st', bookingId: id, idempotencyKey: `transfer:${id}` }])
  expect(await releasedAt(id)).not.toBeNull()
})

it('settle zero: one refund of the full amount, no commission', async () => {
  const id = await paidBooking()
  expect(await settle(db, id, 0)).toEqual({ refunded: 100, transferred: 0, commission: 0 })
  expect(await rows(id)).toEqual({ refund: { amount: '100.00', key: `refund:${id}` } })
  expect(callsOf('refund')).toEqual([{ paymentRef: 'pi_st', amountCents: 10000, idempotencyKey: `refund:${id}` }])
  expect(callsOf('transfer')).toEqual([])
})

it('settle zero needs no payout account; any transfer does (409 NO_PAYOUT_ACCOUNT before money moves)', async () => {
  const zero = await paidBooking({ provider: bareProviderId })
  expect(await settle(db, zero, 0)).toEqual({ refunded: 100, transferred: 0, commission: 0 })
  const id = await paidBooking({ provider: bareProviderId })
  expect(await refusal(settle(db, id, 40))).toEqual({ status: 409, body: { error: 'NO_PAYOUT_ACCOUNT' } })
  expect(callsOf('refund')).toHaveLength(1) // only the zero settlement's
  expect(await rows(id)).toEqual({})
  expect(await releasedAt(id)).toBeNull()
})

it('settle partial 40 of 100 at 0.12: refund 60, transfer 35.20, commission 4.80', async () => {
  const id = await paidBooking()
  expect(await settle(db, id, 40)).toEqual({ refunded: 60, transferred: 35.2, commission: 4.8 })
  expect(await rows(id)).toEqual({
    refund: { amount: '60.00', key: `refund:${id}` },
    transfer: { amount: '35.20', key: `transfer:${id}` },
    commission: { amount: '4.80', key: `commission:${id}` },
  })
  expect(callsOf('refund')).toEqual([{ paymentRef: 'pi_st', amountCents: 6000, idempotencyKey: `refund:${id}` }])
  expect(callsOf('transfer')).toMatchObject([{ amountCents: 3520, idempotencyKey: `transfer:${id}` }])
})

it('money math is in cents: 33.33 and 0.07 leave no float drift', async () => {
  const a = await paidBooking({ paid: 33.33 })
  expect(await settle(db, a, 33.33)).toEqual({ refunded: 0, transferred: 29.33, commission: 4 }) // 3333 * 0.12 = 399.96 -> 400
  const b = await paidBooking({ paid: 0.07 })
  expect(await settle(db, b, 0.07)).toEqual({ refunded: 0, transferred: 0.06, commission: 0.01 }) // 7 * 0.12 = 0.84 -> 1
  const c = await paidBooking({ paid: 33.33 })
  expect(await settle(db, c, 0.1)).toEqual({ refunded: 33.23, transferred: 0.09, commission: 0.01 })
  expect(callsOf('transfer').map((t) => (t as { amountCents: number }).amountCents)).toEqual([2933, 6, 9])
  expect(callsOf('refund').map((t) => (t as { amountCents: number }).amountCents)).toEqual([3323])
})

it('the ledger sums per booking balance: charge = refund + transfer + commission once settled', async () => {
  const id = await paidBooking({ paid: 77.77 })
  await settle(db, id, 50.01)
  const sums = (await pool.query("SELECT sum(amount) FILTER (WHERE kind = 'charge') AS charge, sum(amount) FILTER (WHERE kind <> 'charge') AS out FROM ledger_entries WHERE booking_id = $1", [id])).rows[0]
  expect(sums.charge).toBe('77.77')
  expect(sums.out).toBe('77.77')
})

it("the commission rate used is the booking's stored rate, not the current constant", async () => {
  const id = await paidBooking({ rate: 0.2 })
  expect(await settle(db, id, 100)).toEqual({ refunded: 0, transferred: 80, commission: 20 })
})

it('settle twice writes the rows once (second call 409, gateway called once per key)', async () => {
  const id = await paidBooking()
  await settle(db, id, 40)
  expect(await refusal(settle(db, id, 40))).toEqual({ status: 409, body: { error: 'ALREADY_SETTLED' } })
  expect((await pool.query('SELECT count(*)::int n FROM ledger_entries WHERE booking_id = $1', [id])).rows[0].n).toBe(4) // charge + 3
  expect(callsOf('refund')).toHaveLength(1)
  expect(callsOf('transfer')).toHaveLength(1)
})

it('a gateway failure leaves released_at null and no rows', async () => {
  const id = await paidBooking()
  g.transfer = async () => {
    throw new Error('gateway down')
  }
  await expect(settle(db, id, 100)).rejects.toThrow('gateway down')
  expect(await releasedAt(id)).toBeNull()
  expect(await rows(id)).toEqual({})
})

it('a retry after a failure between refund and transfer completes without a second refund', async () => {
  const id = await paidBooking()
  const transfer = g.transfer
  g.transfer = async () => {
    throw new Error('gateway down')
  }
  await expect(settle(db, id, 40)).rejects.toThrow('gateway down')
  expect(await releasedAt(id)).toBeNull()
  expect(await rows(id)).toEqual({ refund: { amount: '60.00', key: `refund:${id}` } }) // the refund that happened is recorded
  g.transfer = transfer
  expect(await settle(db, id, 40)).toEqual({ refunded: 60, transferred: 35.2, commission: 4.8 })
  expect(callsOf('refund')).toHaveLength(1)
  expect(Object.keys(await rows(id)).sort()).toEqual(['commission', 'refund', 'transfer'])
  expect(await releasedAt(id)).not.toBeNull()
  // a retry may not change the split once part of it has moved
  const other = await paidBooking()
  g.transfer = async () => {
    throw new Error('gateway down')
  }
  await expect(settle(db, other, 40)).rejects.toThrow('gateway down')
  g.transfer = transfer
  expect(await refusal(settle(db, other, 50))).toEqual({ status: 409, body: { error: 'SETTLEMENT_MISMATCH' } })
  expect(callsOf('refund')).toHaveLength(2) // no refund of the new split
})

it('settle refuses a bad share, an unpaid and an unknown booking', async () => {
  const id = await paidBooking()
  for (const share of [-1, 100.01, 10.005, Number.NaN]) expect((await refusal(settle(db, id, share))).status).toBe(400)
  const unpaid = await paidBooking()
  await pool.query('UPDATE bookings SET paid_at = NULL WHERE id = $1', [unpaid])
  expect(await refusal(settle(db, unpaid, 0))).toEqual({ status: 409, body: { error: 'NOT_PAID' } })
  expect((await refusal(settle(db, 'not-a-uuid', 0))).status).toBe(404)
  expect((await refusal(settle(db, '00000000-0000-4000-8000-000000000000', 0))).status).toBe(404)
  expect(g.calls).toEqual([])
})

it('two parallel settles of the same booking: exactly one wins', async () => {
  const id = await paidBooking()
  // hold the booking row: both settles must wait for it (proves they lock it), then exactly one wins
  const holder = await pool.connect()
  let both: Promise<{ status: number }[]>
  try {
    await holder.query('BEGIN')
    await holder.query('SELECT id FROM bookings WHERE id = $1 FOR UPDATE', [id])
    both = Promise.all([refusal(settle(db, id, 40)), refusal(settle(db, id, 40))])
    await new Promise((ok) => setTimeout(ok, 500))
    expect(g.calls).toEqual([])
    await holder.query('COMMIT')
  } finally {
    holder.release()
  }
  expect((await both).map((r) => r.status).sort()).toEqual([0, 409])
  expect(callsOf('refund')).toHaveLength(1)
  expect(callsOf('transfer')).toHaveLength(1)
  expect((await pool.query("SELECT count(*)::int n FROM ledger_entries WHERE booking_id = $1 AND kind <> 'charge'", [id])).rows[0].n).toBe(3)
})

it('deleting an account with a confirmed booking is 409 OPEN_BOOKINGS', async () => {
  const id = await paidBooking()
  for (const uid of [U.cust, U.owner]) expect(await refusal(deleteAccount(uid, EMAIL(uid), () => {}))).toEqual({ status: 409, body: { error: 'OPEN_BOOKINGS' } })
  expect((await pool.query('SELECT count(*)::int n FROM bookings WHERE id = $1', [id])).rows[0].n).toBe(1)
  expect((await pool.query('SELECT count(*)::int n FROM users WHERE id = ANY($1)', [[U.cust, U.owner]])).rows[0].n).toBe(2)
})
