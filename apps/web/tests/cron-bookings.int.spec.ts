import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { db, pool } from '@kando/db'
import { tryRelease, withDeferredInvoices } from '@kando/domain'
import { setGatewayForTests, setStorageForTests } from '@kando/domain/src/testing'
import { cleanupUsers, memoryStorage, seedBase, seedProvider, seedUser } from './helpers'
import { fakeGateway } from './fake-gateway'

const routes = {
  bookings: await import('../app/api/cron/bookings/route'),
  money: await import('../app/api/cron/money/route'),
  invoices: await import('../app/api/cron/invoices/route'),
  suspensions: await import('../app/api/cron/suspensions/route'),
}
const get = (name: keyof typeof routes, auth?: string) => routes[name].GET(new Request(`http://localhost/api/cron/${name}`, { headers: auth ? { authorization: auth } : {} }))

beforeEach(() => vi.stubEnv('CRON_SECRET', 's3cret'))
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  setGatewayForTests(undefined)
  setStorageForTests(undefined)
})
beforeAll(cleanupUsers)
afterAll(cleanupUsers)

it('every cron route answers 401 without the secret', async () => {
  for (const name of Object.keys(routes) as (keyof typeof routes)[]) {
    vi.stubEnv('CRON_SECRET', 's3cret')
    expect((await get(name)).status, name).toBe(401)
    expect((await get(name, 'Bearer wrong')).status, name).toBe(401)
    vi.stubEnv('CRON_SECRET', '')
    expect((await get(name, 'Bearer ')).status, name).toBe(401)
    expect((await get(name, 'Bearer undefined')).status, name).toBe(401)
    expect(routes[name].maxDuration, name).toBe(60)
  }
})

it('200 with the report for the right token', async () => {
  const res = await get('bookings', 'Bearer s3cret')
  expect(res.status).toBe(200)
  expect(Object.keys(await res.json()).sort()).toEqual(['askedDone', 'autoReleased', 'cancelsSettled', 'commissionInvoices', 'confirmReminders', 'customersWaiting', 'decisionsApplied', 'ignoredNoticeFlags', 'ignoredNotices', 'invoicesIssued', 'noShowsResolved', 'overdueDisputes', 'proposalsLapsed', 'quotesExpired', 'remindersSent', 'requestsExpired', 'reviewsShown', 'sentToStaff', 'stopsToStaff', 'unpaidExpired'])
})

it('each cron route has its own budget: a slow release does not stop the invoices route', async () => {
  vi.stubEnv('PAYMENTS_ENABLED', 'true')
  const g = fakeGateway()
  setGatewayForTests(g)
  setStorageForTests(memoryStorage())
  const { categoryId } = await seedBase()
  await seedUser('cb-cust', null, 'Cb Kunde')
  const prov = await seedProvider('cb-owner', { name: 'Cb Owner', categoryId, price: 100 })
  await pool.query("UPDATE users SET first_name = 'Hans', last_name = 'Müller' WHERE id = 'cb-owner'")
  await pool.query("UPDATE providers SET stripe_account_id = 'acct_cb', payouts_ready_at = now(), invoice_consent_at = now() WHERE id = $1", [prov])
  const paid = async (confirmBy: string) => {
    const id = (
      await pool.query(
        `INSERT INTO bookings (customer_id, provider_id, source, status, start_at, duration_min, on_site, address_street, address_postcode, address_city, amount, pay_by, paid_at, payment_ref, commission_rate, finished_at, confirm_by)
         VALUES ('cb-cust', $1, 'direct', 'finished', now() - interval '9 days', 60, true, 'Hauptstr. 1', '10115', 'Berlin', 100, now() - interval '10 days', now() - interval '10 days', gen_random_uuid()::text, 0.12, now() - interval '8 days', now() - interval '${confirmBy}') RETURNING id`,
        [prov],
      )
    ).rows[0].id as string
    await pool.query("INSERT INTO ledger_entries (booking_id, provider_id, kind, amount, gateway_ref, idempotency_key) VALUES ($1, $2, 'charge', 100, 'pi_x', $3)", [id, prov, `charge:${id}`])
    return id
  }
  // released earlier with its invoice left for later (as the money route leaves it)
  const done = await paid('2 days')
  expect(await withDeferredInvoices(() => tryRelease(db, done, 'cb-cust', new Date()))).toBe(true)
  await paid('1 day')
  await paid('1 day')
  // every transfer takes a minute on the fake clock: the money route uses up its budget after the first release
  let offset = 0
  const realNow = Date.now.bind(Date)
  vi.spyOn(Date, 'now').mockImplementation(() => realNow() + offset)
  const transfer = g.transfer.bind(g)
  g.transfer = async (a) => {
    offset += 60_000
    return transfer(a)
  }
  const money = await (await get('money', 'Bearer s3cret')).json()
  expect(money.autoReleased).toBe(1)
  // the invoices route starts with its own budget: the invoice still goes out
  const invoices = await (await get('invoices', 'Bearer s3cret')).json()
  expect(invoices.invoicesIssued).toBeGreaterThanOrEqual(1)
  expect((await pool.query('SELECT root_booking_id FROM invoices WHERE provider_id = $1', [prov])).rows.map((r) => r.root_booking_id)).toContain(done)
})
