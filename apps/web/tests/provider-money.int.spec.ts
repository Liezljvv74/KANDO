import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { db, pool } from '@kando/db'
import { ProviderMoneySchema } from '@kando/contract'
import { COMMISSION_RATE, currencyOfCountry, getMe, providerMoney, UnknownCountryError, youReceive } from '@kando/domain'
import { call, cleanupUsers, seedBase, seedBooking, seedProvider, seedUser } from './helpers'

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
  const id = await seedBooking({
    customerId: U.cust,
    providerId,
    amount,
    cols: {
      status: o.status,
      start_at: new Date(Date.now() - 3 * 86_400_000),
      on_site: false,
      pay_by: new Date(),
      paid_at: new Date(),
      payment_ref: `pi_pm_${++n}`,
      commission_rate: COMMISSION_RATE,
      released_at: o.releasedAt ?? null,
      no_show: o.noShow ?? null,
      no_show_reported_at: o.noShow ? new Date() : null,
    },
  })
  if (o.releasedAt) await pool.query("INSERT INTO ledger_entries (booking_id, provider_id, kind, amount, gateway_ref, idempotency_key) VALUES ($1, $2, 'transfer', $3, 'tr_x', $4)", [id, providerId, net(amount), `transfer:${id}`])
  return id
}
const money = async (uid: string) => ProviderMoneySchema.parse(await (await call(route.GET, uid)).json())

it('received this month counts only releases in the current calendar month', async () => {
  const p = await provider()
  await paid(p.id, { status: 'completed', releasedAt: new Date() })
  await paid(p.id, { status: 'completed', releasedAt: day(-70), amount: 250 })
  expect(await money(p.uid)).toEqual({ receivedThisMonth: net(100), onItsWay: 0, onHold: 0, currency: 'EUR' })
})

it("received this month uses the caller's own month when it is given", async () => {
  const p = await provider()
  await paid(p.id, { status: 'completed', releasedAt: new Date() })
  await paid(p.id, { status: 'completed', releasedAt: day(-30), amount: 250 })
  const m = await providerMoney(db, p.id, new Date(), { from: day(-45), to: day(-15) })
  expect(m.receivedThisMonth).toBe(net(250))
})

it('on hold covers problem and delayed jobs', async () => {
  const p = await provider()
  await paid(p.id, { status: 'disputed' })
  await paid(p.id, { status: 'confirmed', noShow: 'customer', amount: 50 })
  const delayed = await paid(p.id, { status: 'completed', amount: 200 })
  await pool.query("INSERT INTO staff_flags (kind, ref_id, user_id, note) VALUES ('refund-failed', $1, $2, 'test')", [delayed, U.cust])
  expect(await money(p.uid)).toEqual({ receivedThisMonth: 0, onItsWay: 0, onHold: net(100) + net(50) + net(200), currency: 'EUR' })
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

it("the strip carries the currency of the provider's country, unchanged (ZAR)", async () => {
  const p = await provider()
  await pool.query("INSERT INTO currencies (code) VALUES ('ZAR') ON CONFLICT DO NOTHING")
  await pool.query("INSERT INTO countries (code, name_de, name_en, postcode_pattern, currency) VALUES ('ZA', 'Suedafrika', 'South Africa', '^[0-9]{4}$', 'ZAR') ON CONFLICT DO NOTHING")
  try {
    await pool.query("UPDATE providers SET country = 'ZA' WHERE id = $1", [p.id])
    await paid(p.id, { status: 'confirmed' })
    expect(await money(p.uid)).toEqual({ receivedThisMonth: 0, onItsWay: net(100), onHold: 0, currency: 'ZAR' })
    expect(await currencyOfCountry(db, 'ZA')).toBe('ZAR')
    await pool.query("UPDATE users SET is_provider = true WHERE id = (SELECT owner_id FROM providers WHERE id = $1)", [p.id])
    expect((await db.transaction((tx) => getMe(tx, p.uid))).currency).toBe('ZAR') // /me carries it for the quote preview
  } finally {
    await pool.query("UPDATE providers SET country = 'DE' WHERE id = $1", [p.id])
    await pool.query("DELETE FROM countries WHERE code = 'ZA'")
    await pool.query("DELETE FROM currencies WHERE code = 'ZAR'")
  }
})

it('an unknown country is a named error, not a crash on undefined', async () => {
  await expect(currencyOfCountry(db, 'XX')).rejects.toBeInstanceOf(UnknownCountryError)
})

it('a customer cannot read provider money', async () => {
  expect((await call(route.GET, U.cust)).status).toBe(403)
})
