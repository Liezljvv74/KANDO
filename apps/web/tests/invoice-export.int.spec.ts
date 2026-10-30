import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { pool } from '@kando/db'
import { yearOf, type InvoiceDraft } from '@kando/domain'
import { cleanupUsers, EMAIL, seedBase, seedProvider, seedUser } from './helpers'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const route = await import('../app/app-api/v1/invoices/export/route')

const U = { cust: 'ie-cust', other: 'ie-other-p', mine: 'ie-p' }
let providerId: string
let otherId: string

const get = (uid: string, query = '') =>
  route.GET(new Request(`http://localhost/app-api/v1/invoices/export${query}`, { headers: { cookie: `uid=${uid}:${EMAIL(uid)}` } }), { params: Promise.resolve({}) })

const draft = (name: string, t: { labour: number; material: number; net: number; vat: number; gross: number }): InvoiceDraft =>
  ({ kind: 'invoice', legalStatus: 'business', issuer: { name: 'I', address: null, taxId: null }, recipient: { name, address: null, taxId: null }, lines: [], totals: t, vatRate: 0.19, currency: 'EUR', notes: [] }) as InvoiceDraft

async function add(pid: string, number: string, issuedAt: string, d: InvoiceDraft, kind = 'invoice') {
  await pool.query(
    `INSERT INTO invoices (root_booking_id, provider_id, customer_id, number, kind, issued_at, currency, total, draft) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'EUR', $6, $7)`,
    [pid, U.cust, number, kind, issuedAt, d.totals.gross, JSON.stringify(d)],
  )
}
const body = async (res: Response) => (await res.text()).replace(/^\uFEFF/, '').split('\r\n').filter(Boolean)
const HEAD = 'number,date,customer,labour,material,net,vat,gross,currency,kind'

beforeAll(async () => {
  await cleanupUsers()
  const { categoryId } = await seedBase()
  await seedUser(U.cust)
  providerId = await seedProvider(U.mine, { name: 'IE Mine', categoryId, price: 100 })
  otherId = await seedProvider(U.other, { name: 'IE Other', categoryId, price: 100 })
  const t = { labour: 80, material: 20, net: 100, vat: 19, gross: 119 }
  await add(providerId, 'A-2025-0001', '2025-06-01T10:00:00Z', draft('Zoë Müller', t))
  await add(providerId, 'A-2025-0002', '2025-12-31T22:30:00Z', draft('Sylvester, "Sly" Stallone', { labour: 10.5, material: 0, net: 10.5, vat: 0, gross: 10.5 }), 'receipt') // 23:30 Berlin, 31 Dec
  await add(providerId, 'A-2026-0001', '2025-12-31T23:30:00Z', draft('New Year', t)) // 00:30 Berlin, 1 Jan 2026
  await add(providerId, 'A-2025-0003', '2025-07-01T10:00:00Z', draft('=HYPERLINK("http://x","y")', t))
  await add(otherId, 'B-2025-0001', '2025-06-02T10:00:00Z', draft('Not Mine', t))
})
afterAll(cleanupUsers)

it('the provider gets this year\'s invoices only, totals match the PDFs', async () => {
  const res = await get(U.mine, '?year=2025')
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toContain('text/csv')
  expect(res.headers.get('content-disposition')).toMatch(/^attachment/)
  expect([...new Uint8Array(await res.clone().arrayBuffer()).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
  const lines = await body(res)
  expect(lines[0]).toBe(HEAD)
  expect(lines[1]).toBe('A-2025-0001,2025-06-01,Zoë Müller,80.00,20.00,100.00,19.00,119.00,EUR,invoice')
  expect(lines.some((l) => l.includes('B-2025-0001') || l.includes('Not Mine'))).toBe(false) // another provider's never
})

it('year boundaries use the app time zone', async () => {
  const y25 = (await body(await get(U.mine, '?year=2025'))).join('\n')
  const y26 = (await body(await get(U.mine, '?year=2026'))).join('\n')
  expect(y25).toContain('A-2025-0002,2025-12-31')
  expect(y25).not.toContain('A-2026-0001')
  expect(y26).toContain('A-2026-0001,2026-01-01')
  expect(y26).not.toContain('A-2025-0002')
})

it('quotes commas and quotes, keeps plain decimals', async () => {
  const l = (await body(await get(U.mine, '?year=2025'))).find((x) => x.startsWith('A-2025-0002'))
  expect(l).toBe('A-2025-0002,2025-12-31,"Sylvester, ""Sly"" Stallone",10.50,0.00,10.50,0.00,10.50,EUR,receipt')
})

it('a formula in a customer name is neutralised', async () => {
  const l = (await body(await get(U.mine, '?year=2025'))).find((x) => x.startsWith('A-2025-0003'))
  expect(l).toContain(`"'=HYPERLINK(""http://x"",""y"")"`)
  expect(l).not.toMatch(/,=HYPERLINK/)
})

it('a customer gets an empty export', async () => {
  expect(await body(await get(U.cust, '?year=2025'))).toEqual([HEAD])
})

it('year=abc is 400, as is a year out of range or not whole', async () => {
  for (const q of ['?year=abc', '?year=2019', '?year=2999', '?year=2025.5', '?year=', '?year=-2025', '?year=99999999999999999999', '?year=2025&year=2026', '?year=2025&year=2025']) {
    const res = await get(U.mine, q)
    expect([q, res.status, await res.json()]).toEqual([q, 400, { error: 'BAD_YEAR' }])
  }
})

it('defaults to the current year', async () => {
  expect((await get(U.mine)).headers.get('content-disposition')).toContain(`invoices-${yearOf(new Date())}.csv`) // the year in the app's time zone
})
