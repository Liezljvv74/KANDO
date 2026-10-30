import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { asUser, db, pool } from '@kando/db'
import { CommissionInvoiceListSchema } from '@kando/contract'
import { cancelBooking, clearOutbox, clearPushOutbox, pushOutboxForTests, deleteAccount, issueCommissionInvoices, runDueTimers, setGatewayForTests, setStorageForTests, tryRelease, type CommissionDraft, type Storage } from '@kando/domain'
import { call, cleanupUsers, memoryStorage, seedBase, seedProvider, seedUser } from './helpers'
import { fakeGateway } from './fake-gateway'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const listRoute = await import('../app/app-api/v1/commission-invoices/route')
const pdfRoute = await import('../app/app-api/v1/commission-invoices/[id]/pdf/route')

const U = { cust: 'ci-cust', third: 'ci-third' }
let categoryId: string
let store: ReturnType<typeof memoryStorage>
let n = 0

beforeAll(async () => {
  await cleanupUsers()
  categoryId = (await seedBase()).categoryId
  await seedUser(U.cust, null, 'Kai Kunde')
  await seedUser(U.third)
})
beforeEach(() => {
  vi.stubEnv('PAYMENTS_ENABLED', 'true')
  setGatewayForTests(fakeGateway())
  store = memoryStorage()
  setStorageForTests(store)
  clearOutbox()
})
afterEach(() => {
  setGatewayForTests(undefined)
  setStorageForTests(undefined)
  vi.unstubAllEnvs()
})
afterAll(cleanupUsers)

async function provider(): Promise<{ uid: string; id: string }> {
  const uid = `ci-p${++n}`
  const id = await seedProvider(uid, { name: `Ci ${n}`, categoryId, price: 100 })
  await pool.query("UPDATE users SET first_name = 'Hans', last_name = 'Müller' WHERE id = $1", [uid])
  await pool.query('UPDATE providers SET stripe_account_id = $2, payouts_ready_at = now(), invoice_consent_at = now() WHERE id = $1', [id, `acct_ci_${n}`])
  return { uid, id }
}

/** A settled booking as settle leaves it (released, charge + transfer + commission rows) with its money rows written at `at`. */
async function settled(providerId: string, at: Date, amount = 100, rate = 0.12): Promise<string> {
  const id = (
    await pool.query(
      `INSERT INTO bookings (customer_id, provider_id, source, status, start_at, duration_min, on_site, amount, pay_by, paid_at, payment_ref, commission_rate, finished_at, released_at)
       VALUES ($1, $2, 'direct', 'completed', $3::timestamptz - interval '1 day', 60, false, $4, $3, $3, $5, $6, $3, $3) RETURNING id`,
      [U.cust, providerId, at, amount, `pi_ci_${++n}`, rate],
    )
  ).rows[0].id as string
  const commission = Math.round(amount * rate * 100) / 100
  for (const [kind, value] of [['charge', amount], ['transfer', amount - commission], ['commission', commission]] as const) {
    await pool.query('INSERT INTO ledger_entries (booking_id, provider_id, kind, amount, gateway_ref, idempotency_key, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)', [id, providerId, kind, value, 'pi_x', `${kind}:${id}`, at])
  }
  return id
}

const of = async (providerId: string) => (await pool.query('SELECT * FROM commission_invoices WHERE provider_id = $1 ORDER BY month', [providerId])).rows
const readyNotices = async (uid: string) => (await pool.query("SELECT payload FROM notifications WHERE kind = 'commission-invoice-ready' AND user_id = $1", [uid])).rows
const pdfOf = (inv: { file_key: string }) => store.objects.get(`documents/${inv.file_key}`)
const seq = (number: string) => Number(number.split('-').at(-1))

it('two commissions in January give one January invoice with their sum', async () => {
  const p = await provider()
  const a = await settled(p.id, new Date('2031-01-05T10:00:00Z'))
  const b = await settled(p.id, new Date('2031-01-20T10:00:00Z'), 250)
  await settled(p.id, new Date('2030-12-31T10:00:00Z')) // December: not on it (its own invoice)
  const now = new Date('2031-02-01T08:00:00Z')
  expect(await issueCommissionInvoices(db, now, { clock: () => now })).toBe(2) // the number's year is the year of issue
  const [dec, inv, ...more] = await of(p.id)
  expect(more).toEqual([])
  expect([dec.month, dec.total]).toEqual(['2030-12', '12.00'])
  expect(inv).toMatchObject({ month: '2031-01', total: '42.00', currency: 'EUR', file_key: `commission-invoices/${p.id}/${inv.number}.pdf` })
  expect(inv.number).toMatch(/^TEST-K-2031-\d{5}$/) // payments not live: a test document in its own series
  const draft = inv.draft as CommissionDraft
  expect(draft.lines.map((l) => [l.bookingId, l.amount])).toEqual([
    [a, 12],
    [b, 30],
  ])
  expect(draft.issuer.name).toBe('[LEGAL NAME]')
  expect(draft.recipient).toEqual({ name: 'Hans Müller', address: expect.any(String), taxId: null })
  expect(draft.notes).toContain('[VAT WORDING: TAX ADVISER]')
  const pdf = pdfOf(inv)!
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
  expect(store.types.get(`documents/${inv.file_key}`)).toBe('application/pdf')
  expect(await readyNotices(p.uid)).toHaveLength(2)
})

it('a commission at 23:30 UTC on 31 January is on February\'s invoice', async () => {
  const p = await provider()
  await settled(p.id, new Date('2032-01-31T22:30:00Z')) // 23:30 in Berlin: January
  const feb = await settled(p.id, new Date('2032-01-31T23:30:00Z')) // 00:30 on 1 February in Berlin
  await issueCommissionInvoices(db, new Date('2032-02-15T12:00:00Z'))
  expect((await of(p.id)).map((i) => [i.month, i.total])).toEqual([['2032-01', '12.00']])
  await issueCommissionInvoices(db, new Date('2032-03-01T00:30:00Z')) // 01:30 on 1 March in Berlin: February is over
  const [, f] = await of(p.id)
  expect([f.month, (f.draft as CommissionDraft).lines.map((l) => l.bookingId)]).toEqual(['2032-02', [feb]])
})

it('summer time: 00:30 on 1 April in Berlin (22:30 UTC on 31 March) is April, 23:30 on 31 March is March', async () => {
  const p = await provider()
  const march = await settled(p.id, new Date('2033-03-31T21:30:00Z'))
  const april = await settled(p.id, new Date('2033-03-31T22:30:00Z'))
  // 1 April 01:10 in Berlin is 23:10 UTC on 31 March: March ended over an hour ago
  expect(await issueCommissionInvoices(db, new Date('2033-03-31T23:10:00Z'))).toBe(1)
  await issueCommissionInvoices(db, new Date('2033-05-01T09:00:00Z'))
  expect((await of(p.id)).map((i) => [i.month, (i.draft as CommissionDraft).lines.map((l) => l.bookingId)])).toEqual([
    ['2033-03', [march]],
    ['2033-04', [april]],
  ])
})

it('a second run creates nothing', async () => {
  const p = await provider()
  await settled(p.id, new Date('2034-01-10T10:00:00Z'))
  const now = new Date('2034-02-02T10:00:00Z')
  await pool.query("INSERT INTO push_tokens (user_id, token, platform) VALUES ($1, 'ExponentPushToken[ci-second]', 'ios')", [p.uid])
  clearPushOutbox()
  expect(await issueCommissionInvoices(db, now)).toBe(1)
  expect(pushOutboxForTests().map((m) => m.data)).toEqual([{ url: 'skilled://invoices/commission', kind: 'commission-invoice-ready' }]) // opens the commission list
  const [inv] = await of(p.id)
  expect(await issueCommissionInvoices(db, now)).toBe(0)
  expect(await of(p.id)).toEqual([inv])
  expect(await readyNotices(p.uid)).toHaveLength(1)
})

it('concurrent runs create one invoice and leave no gap in the numbers', async () => {
  const p = await provider()
  const q = await provider()
  await settled(p.id, new Date('2035-01-10T10:00:00Z'))
  const now = new Date('2035-02-02T10:00:00Z')
  const run = (at: Date) => issueCommissionInvoices(db, at, { clock: () => at })
  const counts = await Promise.all([run(now), run(now), run(now)])
  expect(counts.reduce((s, x) => s + x, 0)).toBe(1)
  const [first] = await of(p.id)
  expect(await of(p.id)).toHaveLength(1)
  expect(await readyNotices(p.uid)).toHaveLength(1)
  // the next invoice of the series takes the very next number
  await settled(q.id, new Date('2035-02-10T10:00:00Z'))
  await Promise.all([run(new Date('2035-03-02T10:00:00Z')), run(new Date('2035-03-02T10:00:00Z'))])
  const [next] = await of(q.id)
  expect(next.number.slice(0, 12)).toBe(first.number.slice(0, 12))
  expect(seq(next.number)).toBe(seq(first.number) + 1)
  expect((await pool.query("SELECT last FROM invoice_counters WHERE series = 'commission:2035:test'")).rows[0].last).toBe(seq(next.number))
})

it('a month without commission creates nothing', async () => {
  const p = await provider()
  await settled(p.id, new Date('2036-03-02T10:00:00Z')) // March is still running
  const run = (at: Date) => issueCommissionInvoices(db, at, { clock: () => at })
  expect(await run(new Date('2036-03-05T10:00:00Z'))).toBe(0) // February: no commission
  expect(await of(p.id)).toEqual([])
  expect((await pool.query("SELECT 1 FROM invoice_counters WHERE series LIKE 'commission:2036%'")).rows).toEqual([]) // no number taken
  expect(await run(new Date('2036-04-05T10:00:00Z'))).toBe(1)
  expect((await of(p.id)).map((i) => i.month)).toEqual(['2036-03'])
})

it('a commission stamped 23:59:59 on the last day waits for the hour after the month: a run at 00:30 issues nothing, 01:30 issues it', async () => {
  const p = await provider()
  const late = await settled(p.id, new Date('2041-01-31T22:59:59Z')) // 23:59:59 on 31 January in Berlin
  expect(await issueCommissionInvoices(db, new Date('2041-01-31T23:30:00Z'))).toBe(0) // 00:30 on 1 February: a settle may still commit
  expect(await of(p.id)).toEqual([])
  expect(await issueCommissionInvoices(db, new Date('2041-02-01T00:30:00Z'))).toBe(1) // 01:30
  const [inv] = await of(p.id)
  expect([inv.month, (inv.draft as CommissionDraft).lines.map((l) => l.bookingId)]).toEqual(['2041-01', [late]])
})

it('a missed month is caught up, oldest first, within the time budget', async () => {
  const p = await provider()
  await settled(p.id, new Date('2042-01-10T10:00:00Z'))
  await settled(p.id, new Date('2042-03-10T10:00:00Z')) // February: none
  const now = new Date('2042-05-10T10:00:00Z')
  let checks = 0
  // time is up after the first invoice (checks: before the due query, before the first, before the second)
  expect(await issueCommissionInvoices(db, now, { clock: () => now, timeUp: () => ++checks > 2 })).toBe(1)
  expect((await of(p.id)).map((i) => i.month)).toEqual(['2042-01'])
  expect(await issueCommissionInvoices(db, now, { clock: () => now })).toBe(1)
  const [jan, mar] = await of(p.id)
  expect(mar.month).toBe('2042-03')
  expect(seq(mar.number)).toBe(seq(jan.number) + 1)
  expect(await issueCommissionInvoices(db, now, { timeUp: () => true })).toBe(0)
})

it('real releases: commission rows from settle are invoiced next month; refunded and provider-cancelled bookings (no commission) give nothing', async () => {
  const p = await provider()
  const q = await provider() // only zero-commission bookings
  const paid = async (providerId: string, status: string, startAt = new Date(Date.now() - 3_600_000)) =>
    (
      await pool.query(
        `INSERT INTO bookings (customer_id, provider_id, source, status, start_at, duration_min, amount, pay_by, paid_at, payment_ref, commission_rate, finished_at, confirm_by)
         VALUES ($1, $2, 'direct', $3, $4, 60, 100, now(), now(), $5, 0.12, now(), now() + interval '7 days') RETURNING id`,
        [U.cust, providerId, status, startAt, `pi_ci_${++n}`],
      )
    ).rows[0].id as string
  const charge = (id: string, providerId: string) => pool.query("INSERT INTO ledger_entries (booking_id, provider_id, kind, amount, gateway_ref, idempotency_key) VALUES ($1, $2, 'charge', 100, 'pi_x', $3)", [id, providerId, `charge:${id}`])
  const done = await paid(p.id, 'finished')
  await charge(done, p.id)
  expect(await tryRelease(db, done, U.cust, new Date())).toBe(true)
  const stopped = await paid(q.id, 'stopped')
  await charge(stopped, q.id)
  await pool.query("UPDATE bookings SET stopped_at = now(), stopped_by = 'customer', stop_amount = 0, stop_stated_at = now(), confirm_by = now() WHERE id = $1", [stopped])
  expect(await tryRelease(db, stopped, U.cust, new Date())).toBe(true)
  const cancelled = await paid(q.id, 'confirmed', new Date(Date.now() + 2 * 3_600_000))
  await charge(cancelled, q.id)
  await asUser(q.uid, (tx) => cancelBooking(tx, q.uid, cancelled))
  // the first day of next month in Berlin, noon
  const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit' }).format(new Date()).split('-').map(Number)
  const next = new Date(Date.UTC(m === 12 ? y! + 1 : y!, m === 12 ? 0 : m!, 1, 11))
  await issueCommissionInvoices(db, next)
  const [inv] = await of(p.id)
  expect([inv.total, (inv.draft as CommissionDraft).lines.map((l) => [l.bookingId, l.amount])]).toEqual(['12.00', [[done, 12]]])
  expect(await of(q.id)).toEqual([])
})

it('a storage failure leaves fileKey null and the next run fills it', async () => {
  const p = await provider()
  await settled(p.id, new Date('2037-01-10T10:00:00Z'))
  const now = new Date('2037-02-02T10:00:00Z')
  setStorageForTests({ ...store, put: async () => Promise.reject(new Error('storage down')) } as Storage)
  expect(await issueCommissionInvoices(db, now)).toBe(1)
  const [inv] = await of(p.id)
  expect(inv.file_key).toBeNull()
  expect(await readyNotices(p.uid)).toEqual([])
  const res = await call(pdfRoute.GET, p.uid, 'GET', undefined, { id: inv.id })
  expect([res.status, (await res.json()).error]).toEqual([409, 'NOT_READY'])
  setStorageForTests(store)
  expect(await issueCommissionInvoices(db, now)).toBe(0)
  const [again] = await of(p.id)
  expect(again.number).toBe(inv.number)
  expect(pdfOf(again)!.subarray(0, 5).toString()).toBe('%PDF-')
  expect(await readyNotices(p.uid)).toHaveLength(1)
})

it('only the provider can download it', async () => {
  const p = await provider()
  await settled(p.id, new Date('2038-01-10T10:00:00Z'))
  await issueCommissionInvoices(db, new Date('2038-02-02T10:00:00Z'))
  const [inv] = await of(p.id)
  const list = async (uid: string) => CommissionInvoiceListSchema.parse(await (await call(listRoute.GET, uid)).json()).docs.filter((d) => d.id === inv.id)
  expect(await list(p.uid)).toEqual([{ id: inv.id, number: inv.number, month: '2038-01', issuedAt: new Date(inv.issued_at).toISOString(), total: 12, currency: 'EUR', pdfReady: true }])
  expect(await list(U.cust)).toEqual([])
  expect(JSON.stringify(await (await call(listRoute.GET, p.uid)).json())).not.toMatch(/pi_|tr_|re_|acct_|ledger|charge|transfer/)
  const res = await call(pdfRoute.GET, p.uid, 'GET', undefined, { id: inv.id })
  expect(res.status).toBe(200)
  expect((await res.json()).url).toBe(`https://signed.test/documents/${inv.file_key}?expires=600`)
  for (const uid of [U.cust, U.third]) expect((await call(pdfRoute.GET, uid, 'GET', undefined, { id: inv.id })).status).toBe(404)
  expect((await call(pdfRoute.GET, p.uid, 'GET', undefined, { id: 'nope' })).status).toBe(404)
  // RLS: the provider's owner reads it, nobody writes it on the app role
  const read = async (uid: string | null) => (await asUser(uid, (tx) => tx.execute(sql`SELECT id FROM commission_invoices WHERE id = ${inv.id}`))).rows.length
  expect([await read(p.uid), await read(U.cust), await read(null)]).toEqual([1, 0, 0])
  const denied = { cause: { message: expect.stringMatching(/permission denied|row-level security/) } }
  await expect(asUser(p.uid, (tx) => tx.execute(sql`UPDATE commission_invoices SET total = 0 WHERE id = ${inv.id}`))).rejects.toMatchObject(denied)
  await expect(asUser(p.uid, (tx) => tx.execute(sql`DELETE FROM commission_invoices WHERE id = ${inv.id}`))).rejects.toMatchObject(denied)
})

it('account deletion keeps the commission invoice and first issues every month still open, the current one too', async () => {
  const p = await provider()
  const gone = await provider()
  await settled(p.id, new Date('2039-01-10T10:00:00Z'))
  await issueCommissionInvoices(db, new Date('2039-02-02T10:00:00Z'))
  const [inv] = await of(p.id)
  await deleteAccount(p.uid, () => {})
  expect((await pool.query('SELECT id FROM providers WHERE id = $1', [p.id])).rows).toEqual([])
  expect(await of(p.id)).toEqual([inv])
  expect(pdfOf(inv)).toBeDefined()
  // an earlier month never invoiced, and this month so far
  const old = await settled(gone.id, new Date('2039-02-10T10:00:00Z'))
  const today = await settled(gone.id, new Date())
  const thisMonth = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit' }).format(new Date())
  await deleteAccount(gone.uid, () => {})
  const issued = await of(gone.id)
  expect(issued.map((i) => [i.month, (i.draft as CommissionDraft).lines.map((l) => l.bookingId), (i.draft as CommissionDraft).recipient.name])).toEqual(
    [[thisMonth, [today], 'Hans Müller'], ['2039-02', [old], 'Hans Müller']].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  )
  for (const i of issued) expect(pdfOf(i)).toBeDefined()
  expect(await issueCommissionInvoices(db, new Date('2039-03-02T10:00:00Z'))).toBe(0) // nothing left for the deleted provider
  await pool.query('DELETE FROM commission_invoices WHERE provider_id IN ($1, $2)', [p.id, gone.id]) // no provider row left for cleanupUsers to find
})

it('an account deletion is refused while a month with commission cannot be invoiced', async () => {
  const p = await provider()
  const b = await settled(p.id, new Date('2043-01-10T10:00:00Z'))
  // a second currency in one month: issuing throws (logged), so the month stays open
  await pool.query("INSERT INTO ledger_entries (booking_id, provider_id, kind, amount, currency, gateway_ref, idempotency_key, created_at) VALUES ($1, $2, 'commission', 1, 'USD', 'x', $3, '2043-01-11T10:00:00Z')", [b, p.id, `commission-usd:${b}`])
  const refused = (await deleteAccount(p.uid, () => {}).catch((e: unknown) => e)) as Response
  expect([refused.status, (await refused.json()).error]).toEqual([409, 'OPEN_BOOKINGS'])
  expect((await pool.query('SELECT id FROM users WHERE id = $1', [p.uid])).rows).toHaveLength(1)
  expect(await of(p.id)).toEqual([])
})

it('runs from the timers inside the run budget', async () => {
  const p = await provider()
  await settled(p.id, new Date('2040-01-10T10:00:00Z'))
  const now = new Date('2040-02-02T10:00:00Z')
  expect((await runDueTimers(db, now, { budgetMs: 0 })).commissionInvoices).toBe(0) // no time left: next run
  expect((await runDueTimers(db, now)).commissionInvoices).toBe(1)
  expect(await of(p.id)).toHaveLength(1)
})
