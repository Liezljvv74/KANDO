import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { asUser, db, pool } from '@kando/db'
import { InvoiceListSchema } from '@kando/contract'
import {
  cancelBooking,
  clearOutbox,
  clearPushOutbox,
  decideDispute,
  deleteAccount,
  dueRoots,
  issueCommissionInvoices,
  issueDueInvoices,
  pushOutboxForTests,
  releaseBooking,
  runDueTimers,
  setGatewayForTests,
  setStorageForTests,
  tryRelease,
  withDeferredInvoices,
  type InvoiceDraft,
  type Storage,
} from '@kando/domain'
import { call, cleanupUsers, memoryStorage, seedBase, seedProvider, seedUser } from './helpers'
import { fakeGateway } from './fake-gateway'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const listRoute = await import('../app/app-api/v1/invoices/route')
const pdfRoute = await import('../app/app-api/v1/invoices/[id]/pdf/route')
const quoteRoute = await import('../app/app-api/v1/requests/[id]/quotes/route')
const profileRoute = await import('../app/app-api/v1/provider-profile/route')

const U = { cust: 'inv-cust', third: 'inv-third', staff: 'inv-staff' }
const HOUR = 3_600_000
let categoryId: string
let store: ReturnType<typeof memoryStorage>
let n = 0

beforeAll(async () => {
  await cleanupUsers()
  categoryId = (await seedBase()).categoryId
  await seedUser(U.cust, null, 'Zoë Łukasz')
  await seedUser(U.third)
  await seedUser(U.staff, 'admin')
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

/** A fresh, ready provider (own numbering series): payouts set up, invoicing agreed. */
async function provider(o: { legalStatus?: string } = {}): Promise<{ uid: string; id: string; prefix: string }> {
  const uid = `inv-p${++n}`
  const id = await seedProvider(uid, { name: `Inv ${n}`, categoryId, price: 100 })
  await pool.query("UPDATE users SET first_name = 'Hans', last_name = 'Müller' WHERE id = $1", [uid])
  await pool.query("UPDATE providers SET stripe_account_id = $2, payouts_ready_at = now(), invoice_consent_at = now(), legal_status = $3 WHERE id = $1", [id, `acct_inv_${n}`, o.legalStatus ?? null])
  // payments are not live in tests: every number is a test number, in the provider's own test series
  return { uid, id, prefix: `TEST-${id.slice(0, 8).toUpperCase()}` }
}

/** A paid booking (as the webhook leaves it) with its charge row; `finished` starts the release clock, `parent` makes it an additional task. */
async function paid(providerId: string, o: { amount?: number; status?: string; parent?: string; startAt?: Date; material?: number; customer?: string } = {}): Promise<string> {
  const amount = o.amount ?? 100
  const startAt = o.startAt ?? new Date(Date.now() - 3 * HOUR)
  const id = (
    await pool.query(
      `INSERT INTO bookings (customer_id, provider_id, source, status, start_at, duration_min, on_site, address_street, address_postcode, address_city, amount, pay_by, paid_at, payment_ref, commission_rate, finished_at, confirm_by, parent_booking_id, material_amount)
       VALUES ($1, $2, 'direct', $3, $4, 60, true, 'Hauptstr. 1', '10115', 'Berlin', $5, $4::timestamptz - interval '2 days', $4::timestamptz - interval '2 days', $6, 0.12, now(), now() + interval '7 days', $7, $8) RETURNING id`,
      [o.customer ?? U.cust, providerId, o.status ?? 'finished', startAt, amount, `pi_${++n}`, o.parent ?? null, o.material ?? 0],
    )
  ).rows[0].id as string
  await pool.query("INSERT INTO ledger_entries (booking_id, provider_id, kind, amount, gateway_ref, idempotency_key) VALUES ($1, $2, 'charge', $3, 'pi_x', $4)", [id, providerId, amount, `charge:${id}`])
  return id
}

const invoicesOf = async (providerId: string) => (await pool.query('SELECT * FROM invoices WHERE provider_id = $1 ORDER BY number', [providerId])).rows
const readyNotices = async (bookingId: string) => (await pool.query("SELECT user_id FROM notifications WHERE kind = 'invoice-ready' AND payload->>'bookingId' = $1 ORDER BY user_id", [bookingId])).rows.map((r) => r.user_id)
const year = (d = new Date()) => Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric' }).format(d))
const pdfOf = (inv: { file_key: string }) => store.objects.get(`documents/${inv.file_key}`)

it('a released booking gets one invoice with one line and a PDF that starts with %PDF-', async () => {
  const p = await provider()
  const b = await paid(p.id, { material: 20 })
  expect(await tryRelease(db, b, U.cust, new Date())).toBe(true)
  const [inv, ...more] = await invoicesOf(p.id)
  expect(more).toEqual([])
  expect(inv).toMatchObject({ root_booking_id: b, customer_id: U.cust, number: `${p.prefix}-${year()}-0001`, kind: 'receipt', currency: 'EUR', total: '100.00', file_key: `invoices/${p.id}/${p.prefix}-${year()}-0001.pdf` })
  const draft = inv.draft as InvoiceDraft
  expect(draft.lines).toEqual([expect.objectContaining({ bookingId: b, kind: 'job', gross: 100, material: 20, labour: 80 })])
  expect(draft.recipient).toEqual({ name: 'Zoë Łukasz', address: 'Hauptstr. 1, 10115 Berlin', taxId: null })
  expect(pdfOf(inv)!.subarray(0, 5).toString()).toBe('%PDF-')
  expect(store.types.get(`documents/${inv.file_key}`)).toBe('application/pdf')
  // both are told once
  expect(await readyNotices(b)).toEqual([U.cust, p.uid].sort())
  // the sweep finds nothing more to do (idempotent)
  await issueDueInvoices(db, new Date())
  expect(await invoicesOf(p.id)).toHaveLength(1)
  expect(await readyNotices(b)).toHaveLength(2)
})

it('a group with an open additional task waits; when the task is released the invoice has two lines', async () => {
  const p = await provider()
  const root = await paid(p.id)
  const child = await paid(p.id, { parent: root, amount: 40, status: 'confirmed' })
  // an open request for another task also holds the group back
  const req = (await pool.query("INSERT INTO requests (customer_id, provider_id, description, answer_by, parent_booking_id) VALUES ($1, $2, 'Noch was', now() + interval '1 day', $3) RETURNING id", [U.cust, p.id, root])).rows[0].id
  await tryRelease(db, root, U.cust, new Date())
  expect(await invoicesOf(p.id)).toEqual([])
  await pool.query("UPDATE bookings SET status = 'finished' WHERE id = $1", [child])
  await tryRelease(db, child, U.cust, new Date())
  expect(await invoicesOf(p.id)).toEqual([]) // the request is still open
  await pool.query("UPDATE requests SET status = 'expired' WHERE id = $1", [req])
  expect(await issueDueInvoices(db, new Date(), { bookingId: root })).toBe(1)
  const [inv] = await invoicesOf(p.id)
  expect((inv.draft as InvoiceDraft).lines.map((l) => [l.bookingId, l.kind, l.gross])).toEqual([
    [root, 'job', 100],
    [child, 'additional-task', 40],
  ])
  expect(inv.total).toBe('140.00')
})

it('a group waits on a disputed additional task until staff decide; the decided share is its line', async () => {
  const p = await provider()
  const root = await paid(p.id)
  const child = await paid(p.id, { parent: root, amount: 40, status: 'disputed' })
  const dispute = (await pool.query("INSERT INTO disputes (booking_id, opened_by, reason, description, decide_by) VALUES ($1, 'customer', 'problem', 'x', now() + interval '14 days') RETURNING id", [child])).rows[0].id
  await tryRelease(db, root, U.cust, new Date())
  await issueDueInvoices(db, new Date())
  expect(await invoicesOf(p.id)).toEqual([])
  await decideDispute(db, U.staff, dispute, { decision: 'partial', providerShare: 15, reason: 'Half done' })
  const [inv] = await invoicesOf(p.id)
  expect((inv.draft as InvoiceDraft).lines.map((l) => [l.kind, l.gross])).toEqual([
    ['job', 100],
    ['additional-task', 15],
  ])
})

it('concurrent issuing creates one invoice and no gap', async () => {
  const p = await provider()
  const a = await paid(p.id)
  await releaseBooking(db, a, new Date()) // released, not yet invoiced (no ending hook here)
  expect(await invoicesOf(p.id)).toEqual([])
  // three sweeps of this group at once (scoped, so other data in the shared database cannot change the count)
  const counts = await Promise.all([issueDueInvoices(db, new Date(), { bookingId: a }), issueDueInvoices(db, new Date(), { bookingId: a }), issueDueInvoices(db, new Date(), { bookingId: a })])
  expect(counts.reduce((s, x) => s + x, 0)).toBe(1)
  expect((await invoicesOf(p.id)).map((i) => i.number)).toEqual([`${p.prefix}-${year()}-0001`])
  expect(await readyNotices(a)).toHaveLength(2) // told once, whichever sweep stored the PDF
  const b = await paid(p.id)
  await releaseBooking(db, b, new Date())
  await Promise.all([issueDueInvoices(db, new Date()), issueDueInvoices(db, new Date())])
  expect((await invoicesOf(p.id)).map((i) => i.number)).toEqual([`${p.prefix}-${year()}-0001`, `${p.prefix}-${year()}-0002`])
  expect((await pool.query('SELECT last FROM invoice_counters WHERE series = $1', [`${p.id}-${year()}-test`])).rows).toEqual([{ last: 2 }])
})

it('numbers restart at 0001 in a new year (Berlin time)', async () => {
  const p = await provider()
  const late = new Date('2031-12-31T22:30:00Z') // 23:30 in Berlin: still 2031
  const early = new Date('2031-12-31T23:30:00Z') // 00:30 on 1 January 2032 in Berlin
  for (const now of [late, late, early]) {
    await releaseBooking(db, await paid(p.id), new Date())
    await issueDueInvoices(db, now, { clock: () => now })
  }
  expect((await invoicesOf(p.id)).map((i) => i.number)).toEqual([`${p.prefix}-2031-0001`, `${p.prefix}-2031-0002`, `${p.prefix}-2032-0001`])
})

it('a storage failure leaves fileKey null and the next run fills it', async () => {
  const p = await provider()
  const b = await paid(p.id)
  const down: Storage = { ...store, put: async () => Promise.reject(new Error('storage down')) }
  setStorageForTests(down)
  expect(await tryRelease(db, b, U.cust, new Date())).toBe(true) // the ending never fails for the invoice
  const [inv] = await invoicesOf(p.id)
  expect(inv.file_key).toBeNull()
  expect(await readyNotices(b)).toEqual([]) // nobody is told before the download works
  const res = await call(pdfRoute.GET, U.cust, 'GET', undefined, { id: inv.id })
  expect([res.status, (await res.json()).error]).toEqual([409, 'NOT_READY'])
  setStorageForTests(store)
  expect(await issueDueInvoices(db, new Date(), { bookingId: b })).toBe(0) // nothing new issued, the PDF filled
  const [again] = await invoicesOf(p.id)
  expect(again.number).toBe(inv.number)
  expect(pdfOf(again)!.subarray(0, 5).toString()).toBe('%PDF-')
  expect(await readyNotices(b)).toHaveLength(2)
})

it('both parties list and download it; a third user gets 404', async () => {
  const p = await provider()
  const b = await paid(p.id)
  await tryRelease(db, b, U.cust, new Date())
  const [inv] = await invoicesOf(p.id)
  const list = async (uid: string) => InvoiceListSchema.parse(await (await call(listRoute.GET, uid)).json()).docs.filter((d) => d.id === inv.id)
  expect(await list(U.cust)).toEqual([{ id: inv.id, number: inv.number, kind: 'receipt', role: 'customer', bookingId: b, issuedAt: new Date(inv.issued_at).toISOString(), total: 100, currency: 'EUR', counterparty: 'Hans Müller', pdfReady: true }])
  expect(await list(p.uid)).toEqual([expect.objectContaining({ id: inv.id, role: 'provider', counterparty: 'Zoë Łukasz' })])
  expect(await list(U.third)).toEqual([])
  // no money references in the list
  expect(JSON.stringify(await (await call(listRoute.GET, U.cust)).json())).not.toMatch(/pi_|tr_|re_|acct_|ledger|charge|transfer|commission/)
  for (const uid of [U.cust, p.uid]) {
    const res = await call(pdfRoute.GET, uid, 'GET', undefined, { id: inv.id })
    expect(res.status).toBe(200)
    expect((await res.json()).url).toBe(`https://signed.test/documents/${inv.file_key}?expires=600`)
  }
  expect((await call(pdfRoute.GET, U.third, 'GET', undefined, { id: inv.id })).status).toBe(404)
  expect((await call(pdfRoute.GET, U.cust, 'GET', undefined, { id: 'not-a-uuid' })).status).toBe(404)
})

it('RLS: invoices are readable by their two parties only and written by nobody on the app role; counters are staff only', async () => {
  const p = await provider()
  const b = await paid(p.id)
  await tryRelease(db, b, U.cust, new Date())
  const [inv] = await invoicesOf(p.id)
  const read = async (uid: string | null) => (await asUser(uid, (tx) => tx.execute(sql`SELECT id FROM invoices WHERE id = ${inv.id}`))).rows.length
  expect([await read(U.cust), await read(p.uid), await read(U.third), await read(null)]).toEqual([1, 1, 0, 0])
  const denied = { cause: { message: expect.stringMatching(/permission denied|row-level security/) } }
  await expect(asUser(U.cust, (tx) => tx.execute(sql`UPDATE invoices SET total = 1 WHERE id = ${inv.id}`))).rejects.toMatchObject(denied)
  await expect(asUser(U.cust, (tx) => tx.execute(sql`DELETE FROM invoices WHERE id = ${inv.id}`))).rejects.toMatchObject(denied)
  await expect(asUser(p.uid, (tx) => tx.execute(sql`INSERT INTO invoices (root_booking_id, provider_id, customer_id, number, kind, issued_at, currency, total, draft) VALUES (gen_random_uuid(), ${p.id}, ${U.cust}, 'X-1', 'invoice', now(), 'EUR', 1, '{}')`))).rejects.toMatchObject(denied)
  await expect(asUser(p.uid, (tx) => tx.execute(sql`SELECT * FROM invoice_counters`))).rejects.toMatchObject(denied)
})

it('account deletion keeps invoices', async () => {
  const p = await provider()
  const cust = 'inv-cust-del'
  await seedUser(cust, null, 'Weg Kunde')
  const b = await paid(p.id, { customer: cust })
  await tryRelease(db, b, cust, new Date())
  const [inv] = await invoicesOf(p.id)
  expect(inv.customer_id).toBe(cust)
  await deleteAccount(cust, () => {})
  expect((await pool.query('SELECT id FROM users WHERE id = $1', [cust])).rows).toEqual([])
  expect((await pool.query('SELECT id FROM bookings WHERE id = $1', [b])).rows).toEqual([])
  const [kept] = await invoicesOf(p.id)
  expect(kept).toEqual(inv)
  expect(pdfOf(kept)).toBeDefined()
  // the provider still lists and downloads it
  expect((await call(pdfRoute.GET, p.uid, 'GET', undefined, { id: inv.id })).status).toBe(200)
})

it('a stop agreed at 0 ends refunded with no invoice; a provider cancellation has none either', async () => {
  const p = await provider()
  const stopped = await paid(p.id, { status: 'stopped' })
  await pool.query("UPDATE bookings SET stopped_at = now(), stopped_by = 'customer', stop_amount = 0, stop_stated_at = now(), confirm_by = now() WHERE id = $1", [stopped])
  expect(await tryRelease(db, stopped, U.cust, new Date())).toBe(true)
  expect((await pool.query('SELECT status FROM bookings WHERE id = $1', [stopped])).rows[0].status).toBe('refunded')
  const future = await paid(p.id, { status: 'confirmed', startAt: new Date(Date.now() + 2 * HOUR) })
  await asUser(p.uid, (tx) => cancelBooking(tx, p.uid, future))
  expect((await pool.query('SELECT status, released_at FROM bookings WHERE id = $1', [future])).rows[0]).toMatchObject({ status: 'cancelled', released_at: expect.any(Date) })
  await issueDueInvoices(db, new Date())
  await issueDueInvoices(db, new Date())
  expect(await invoicesOf(p.id)).toEqual([])
  // no number was taken, and neither group is ever picked again
  expect((await pool.query('SELECT series FROM invoice_counters WHERE series LIKE $1', [`${p.id}-%`])).rows).toEqual([])
  const due = await dueRoots(db, new Date())
  expect(due).not.toContain(stopped)
  expect(due).not.toContain(future)
  // issuing is live for this provider: the next normal booking gets the first number
  await tryRelease(db, await paid(p.id), U.cust, new Date())
  expect((await invoicesOf(p.id)).map((i) => i.number)).toEqual([`${p.prefix}-${year()}-0001`])
})

it('two providers whose ids share the first 8 characters number independently and without gaps', async () => {
  const ids = ['abcd1234-0000-4000-8000-00000000000a', 'abcd1234-0000-4000-8000-00000000000b']
  for (const [i, id] of ids.entries()) {
    await seedUser(`inv-twin${i}`)
    await pool.query("INSERT INTO providers (id, owner_id, type, status, stripe_account_id, payouts_ready_at, invoice_consent_at) VALUES ($1, $2, 'private', 'published', $3, now(), now())", [id, `inv-twin${i}`, `acct_twin_${i}`])
  }
  for (const id of [ids[0]!, ids[1]!, ids[0]!, ids[1]!]) await tryRelease(db, await paid(id), U.cust, new Date())
  for (const id of ids) expect((await invoicesOf(id)).map((i) => i.number)).toEqual([`TEST-ABCD1234-${year()}-0001`, `TEST-ABCD1234-${year()}-0002`])
  expect((await pool.query('SELECT series, last FROM invoice_counters WHERE series LIKE $1 ORDER BY series', ['abcd1234-%'])).rows).toEqual(ids.map((id) => ({ series: `${id}-${year()}-test`, last: 2 })))
})

it('an account deletion first invoices paid-out groups that still wait on an unpaid additional task or an open request', async () => {
  const p = await provider()
  const cust = 'inv-cust-del2'
  await seedUser(cust, null, 'Bald Weg')
  const root = await paid(p.id, { customer: cust })
  // an additional task still awaiting payment, and a request for another: once the root is paid out the group is still not due
  await pool.query("INSERT INTO bookings (customer_id, provider_id, source, status, start_at, duration_min, amount, pay_by, accepted_at, parent_booking_id) VALUES ($1, $2, 'direct', 'awaiting-payment', now(), 60, 40, now() + interval '1 day', now(), $3)", [cust, p.id, root])
  await pool.query("INSERT INTO requests (customer_id, provider_id, description, answer_by, parent_booking_id) VALUES ($1, $2, 'Noch was', now() + interval '1 day', $3)", [cust, p.id, root])
  expect(await tryRelease(db, root, cust, new Date())).toBe(true)
  await issueDueInvoices(db, new Date())
  expect(await invoicesOf(p.id)).toEqual([])
  await deleteAccount(cust, () => {})
  const [inv] = await invoicesOf(p.id)
  expect(inv).toMatchObject({ root_booking_id: root, customer_id: cust })
  expect((inv.draft as InvoiceDraft).lines.map((l) => [l.bookingId, l.kind, l.gross])).toEqual([[root, 'job', 100]])
  expect(pdfOf(inv)).toBeDefined()
})

it('an account deletion is refused while paid-out money has no invoice (issuing failed)', async () => {
  const p = await provider()
  const cust = 'inv-cust-del3'
  await seedUser(cust)
  const root = await paid(p.id, { customer: cust })
  await releaseBooking(db, root, new Date()) // settled, no invoice yet
  await pool.query("UPDATE providers SET country = 'XX' WHERE id = $1", [p.id]) // no VAT rate: issuing throws (logged)
  await expect(deleteAccount(cust, () => {})).rejects.toMatchObject({ status: 409 })
  expect((await pool.query('SELECT id FROM users WHERE id = $1', [cust])).rows).toHaveLength(1)
  await pool.query("UPDATE providers SET country = 'DE' WHERE id = $1", [p.id])
  await deleteAccount(cust, () => {})
  expect(await invoicesOf(p.id)).toHaveLength(1)
})

it('a late customer cancellation is invoiced as a fee line with the provider share', async () => {
  const p = await provider({ legalStatus: 'kleinunternehmer' })
  await pool.query("UPDATE providers SET tax_number = '12/345/67890', business_name = 'Müller Garten', impressum = 'Müller Garten, Hauptstr. 2, 10115 Berlin' WHERE id = $1", [p.id])
  const b = await paid(p.id, { status: 'confirmed', startAt: new Date(Date.now() + 2 * HOUR) })
  await asUser(U.cust, (tx) => cancelBooking(tx, U.cust, b))
  const [inv] = await invoicesOf(p.id)
  expect(inv.kind).toBe('invoice')
  const draft = inv.draft as InvoiceDraft
  expect(draft.lines).toEqual([expect.objectContaining({ kind: 'late-cancel-fee', gross: 50, labour: 0, material: 0 })])
  expect(draft.issuer).toEqual({ name: 'Müller Garten', address: 'Müller Garten, Hauptstr. 2, 10115 Berlin', taxId: '12/345/67890' })
  // the ledger agrees: transfer + commission = the line
  const money = (await pool.query("SELECT sum(amount)::float AS s FROM ledger_entries WHERE booking_id = $1 AND kind IN ('transfer', 'commission')", [b])).rows[0].s
  expect(money).toBe(50)
})

it('a Kleinunternehmer without tax number or VAT id cannot quote when payments are on (409 PAYOUT_SETUP_FIRST)', async () => {
  const p = await provider({ legalStatus: 'kleinunternehmer' })
  await pool.query("UPDATE providers SET strengths = 'Ruhig', skills = '{Garten}' WHERE id = $1", [p.id]) // a complete live profile (the profile save checks it)
  const request = async () => (await pool.query("INSERT INTO requests (customer_id, provider_id, description, answer_by) VALUES ($1, $2, 'Hecke schneiden', now() + interval '3 days') RETURNING id", [U.third, p.id])).rows[0].id
  const quote = async (id: string) => call(quoteRoute.POST, p.uid, 'POST', { amount: 80, scope: 'Hecke' }, { id })
  const r1 = await request()
  let res = await quote(r1)
  expect([res.status, (await res.json()).error]).toEqual([409, 'PAYOUT_SETUP_FIRST'])
  // the payout set-up card: tax number and the consent tick, through the profile
  res = await call(profileRoute.PUT, p.uid, 'PUT', { taxNumber: ' 12/345/67890 ' })
  expect(await res.json()).toMatchObject({ taxNumber: '12/345/67890', invoiceConsent: true })
  expect((await quote(r1)).status).toBe(201)
  // withdrawing the consent stops new quotes again; ticking it again allows them
  res = await call(profileRoute.PUT, p.uid, 'PUT', { invoiceConsent: false })
  expect(await res.json()).toMatchObject({ invoiceConsent: false })
  const r2 = await request()
  expect((await quote(r2)).status).toBe(409)
  await call(profileRoute.PUT, p.uid, 'PUT', { invoiceConsent: true })
  expect((await quote(r2)).status).toBe(201)
  // with payments off nothing of this is needed
  vi.stubEnv('PAYMENTS_ENABLED', '')
  await pool.query('UPDATE providers SET tax_number = NULL, invoice_consent_at = NULL WHERE id = $1', [p.id])
  expect((await quote(await request())).status).toBe(201)
})

it('with live payments and placeholder entity details nothing is issued and no number is used; while not live a TEST document is', async () => {
  const p = await provider()
  const b = await paid(p.id)
  await releaseBooking(db, b, new Date())
  expect(await issueDueInvoices(db, new Date(), { bookingId: b, live: true })).toBe(0)
  expect(await invoicesOf(p.id)).toEqual([])
  expect((await pool.query('SELECT series FROM invoice_counters WHERE series LIKE $1', [`${p.id}-%`])).rows).toEqual([])
  expect(await issueCommissionInvoices(db, new Date('2040-02-01T12:00:00Z'), { live: true })).toBe(0)
  expect((await pool.query("SELECT series FROM invoice_counters WHERE series LIKE 'commission:2040%'")).rows).toEqual([])
  // the next run (not live) issues it: a test number in the test series, with the TEST watermark
  expect(await issueDueInvoices(db, new Date(), { bookingId: b })).toBe(1)
  const [inv] = await invoicesOf(p.id)
  expect(inv.number).toBe(`${p.prefix}-${year()}-0001`)
  expect(pdfOf(inv)!.toString('latin1')).toMatch(/%PDF-/)
  expect((await pool.query('SELECT series FROM invoice_counters WHERE series LIKE $1', [`${p.id}-%`])).rows).toEqual([{ series: `${p.id}-${year()}-test` }])
})

it('the cron releases first; an invoice the time budget did not reach is issued and told by the next run', async () => {
  const p = await provider()
  // a release that went through while invoicing was deferred (as in the cron), then a run with no budget left
  const b = await paid(p.id)
  await withDeferredInvoices(() => tryRelease(db, b, U.cust, new Date()))
  expect((await pool.query('SELECT status FROM bookings WHERE id = $1', [b])).rows[0].status).toBe('completed')
  await runDueTimers(db, new Date(), { budgetMs: 0 })
  expect(await invoicesOf(p.id)).toEqual([])
  expect(await readyNotices(b)).toEqual([])
  // a release due in the cron itself: released, then invoiced in the same run; the pushes go out at the end in one batch
  const due = await paid(p.id)
  await pool.query("UPDATE bookings SET confirm_by = now() - interval '1 minute' WHERE id = $1", [due])
  await pool.query("INSERT INTO push_tokens (user_id, token, platform) VALUES ($1, 'ExponentPushToken[inv-cust]', 'ios') ON CONFLICT DO NOTHING", [U.cust])
  clearPushOutbox()
  const report = await runDueTimers(db, new Date())
  expect(report.autoReleased).toBeGreaterThanOrEqual(1)
  expect(report.invoicesIssued).toBeGreaterThanOrEqual(2)
  expect((await invoicesOf(p.id)).map((i) => i.root_booking_id).sort()).toEqual([b, due].sort())
  for (const x of [b, due]) expect(await readyNotices(x)).toEqual([U.cust, p.uid].sort())
  // a receipt (private provider) is called a receipt in the push, not an invoice
  const titles = pushOutboxForTests().filter((m) => m.to === 'ExponentPushToken[inv-cust]' && m.data.kind === 'invoice-ready').map((m) => m.title)
  expect(titles).toHaveLength(2)
  for (const title of titles) expect(['Beleg fertig', 'Receipt ready']).toContain(title)
  await pool.query("DELETE FROM push_tokens WHERE token = 'ExponentPushToken[inv-cust]'")
})
