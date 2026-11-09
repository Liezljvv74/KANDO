import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { pool } from '@kando/db'
import { ProviderMoneySchema } from '@kando/contract'
import { COMMISSION_RATE, youReceive } from '@kando/domain'
import { call, cleanupUsers, seedBase, seedProvider, seedUser } from './helpers'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const route = await import('../app/app-api/v1/provider-money/route')

const U = { cust: 'pm-cust' }
let categoryId: string
let n = 0
beforeAll(async () => {
  await cleanupUsers()
  categoryId = (await seedBase()).categoryId
  await seedUser(U.cust, null, 'Kai Kunde')
})
afterAll(cleanupUsers)

const net = (amount: number) => youReceive(amount, COMMISSION_RATE)
const day = (d: number) => new Date(Date.now() + d * 86_400_000)

async function provider(): Promise<{ uid: string; id: string }> {
  const uid = `pm-p${++n}`
  return { uid, id: await seedProvider(uid, { name: `Pm ${n}`, categoryId, price: 100 }) }
}

/** A paid booking; `releasedAt` set also writes the transfer row as settle does. */
async function paid(providerId: string, o: { status: string; amount?: number; releasedAt?: Date; noShow?: string }): Promise<string> {
  const amount = o.amount ?? 100
  const id = (
    await pool.query(
      `INSERT INTO bookings (customer_id, provider_id, source, status, start_at, duration_min, on_site, amount, pay_by, paid_at, payment_ref, commission_rate, released_at, no_show, no_show_reported_at)
       VALUES ($1, $2, 'direct', $3, now() - interval '3 days', 60, false, $4, now(), now(), $5, $6, $7, $8, CASE WHEN $8::text IS NULL THEN NULL ELSE now() END) RETURNING id`,
      [U.cust, providerId, o.status, amount, `pi_pm_${++n}`, COMMISSION_RATE, o.releasedAt ?? null, o.noShow ?? null],
    )
  ).rows[0].id as string
  if (o.releasedAt) await pool.query("INSERT INTO ledger_entries (booking_id, provider_id, kind, amount, gateway_ref, idempotency_key) VALUES ($1, $2, 'transfer', $3, 'tr_x', $4)", [id, providerId, net(amount), `transfer:${id}`])
  return id
}
const money = async (uid: string) => ProviderMoneySchema.parse(await (await call(route.GET, uid)).json())

it('received this month counts only releases in the current calendar month', async () => {
  const p = await provider()
  await paid(p.id, { status: 'completed', releasedAt: new Date() })
  await paid(p.id, { status: 'completed', releasedAt: day(-70), amount: 250 })
  expect(await money(p.uid)).toEqual({ receivedThisMonth: net(100), onItsWay: 0, onHold: 0 })
})

it('on hold covers problem and delayed jobs', async () => {
  const p = await provider()
  await paid(p.id, { status: 'disputed' })
  await paid(p.id, { status: 'confirmed', noShow: 'customer', amount: 50 })
  const delayed = await paid(p.id, { status: 'completed', amount: 200 })
  await pool.query("INSERT INTO staff_flags (kind, ref_id, user_id, note) VALUES ('refund-failed', $1, $2, 'test')", [delayed, U.cust])
  expect(await money(p.uid)).toEqual({ receivedThisMonth: 0, onItsWay: 0, onHold: net(100) + net(50) + net(200) })
})

it('on its way excludes held and released', async () => {
  const p = await provider()
  await paid(p.id, { status: 'confirmed' })
  await paid(p.id, { status: 'finished', amount: 40 })
  await paid(p.id, { status: 'disputed', amount: 300 })
  await paid(p.id, { status: 'completed', releasedAt: new Date(), amount: 500 })
  const m = await money(p.uid)
  expect(m.onItsWay).toBe(net(100) + net(40))
  expect(m.onHold).toBe(net(300))
})

it('a customer cannot read provider money', async () => {
  expect((await call(route.GET, U.cust)).status).toBe(403)
})
