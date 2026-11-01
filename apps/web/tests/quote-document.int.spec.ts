import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { db, pool } from '@kando/db'
import { QuoteListSchema, RequestSchema } from '@kando/contract'
import { deleteAccount, issueQuoteDocument, storePendingQuoteDocuments, type Storage } from '@kando/domain'
import { setStorageForTests } from '@kando/domain/src/testing'
import { call, cleanupUsers, memoryStorage, relaxLimits, requestTime, seedBase, seedProvider, seedUser } from './helpers'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const requests = await import('../app/app-api/v1/requests/route')
const quotes = await import('../app/app-api/v1/requests/[id]/quotes/route')
const list = await import('../app/app-api/v1/quotes/route')
const pdf = await import('../app/app-api/v1/quotes/[id]/pdf/route')
const exportRoute = await import('../app/app-api/v1/me/export/route')

const U = { c1: 'qd-c1', c2: 'qd-c2', c3: 'qd-c3', c4: 'qd-c4', c5: 'qd-c5', third: 'qd-third' }
let categoryId: string
let store: ReturnType<typeof memoryStorage>
let n = 0

beforeAll(async () => {
  await cleanupUsers()
  categoryId = (await seedBase()).categoryId
  await seedUser(U.c1, null, 'Zoë Łukasz')
  for (const u of [U.c2, U.c3, U.c4, U.c5, U.third]) await seedUser(u)
})
beforeEach(() => {
  store = memoryStorage()
  setStorageForTests(store)
})
afterEach(() => setStorageForTests(undefined))
afterAll(cleanupUsers)

/** A fresh provider: its own quote series, so the numbers start at 0001. */
async function provider() {
  const uid = `qd-p${++n}`
  const id = await seedProvider(uid, { name: `Qd ${n}`, categoryId })
  await pool.query("UPDATE users SET first_name = 'Hans', last_name = 'Müller' WHERE id = $1", [uid])
  return { uid, id, prefix: `TEST-Q-${id.slice(0, 8).toUpperCase()}-${new Date().getFullYear()}` }
}
const request = async (providerId: string, as: string, extra: object = {}) => {
  await relaxLimits(as)
  return RequestSchema.parse(await (await call(requests.POST, as, 'POST', { providerId, description: 'Fix the fence', ...requestTime(), ...extra })).json())
}
const quote = async (p: { uid: string }, r: { id: string; startAt: string | null; durationMin: number | null }, amount = 100) => {
  const res = await call(quotes.POST, p.uid, 'POST', { amount, scope: 'Fence', startAt: r.startAt, durationMin: r.durationMin }, { id: r.id })
  expect(res.status).toBe(201)
  return res.json()
}
const listing = async (as: string) => QuoteListSchema.parse(await (await call(list.GET, as, 'GET')).json()).docs

it('a sent quote gets a numbered document and a stored PDF, listed for both sides, with a download link', async () => {
  const p = await provider()
  const r = await request(p.id, U.c1)
  const q = await quote(p, r)
  const mine = (await listing(p.uid)).find((d) => d.quoteId === q.id)!
  expect(mine.number).toBe(`${p.prefix}-0001`)
  expect(mine).toMatchObject({ role: 'provider', counterparty: 'Zoë Łukasz', status: 'sent', pdfReady: true, amount: 100 })
  const theirs = (await listing(U.c1)).find((d) => d.quoteId === q.id)!
  expect(theirs).toMatchObject({ role: 'customer', number: mine.number, counterparty: 'Hans Müller' })
  const key = `quotes/${p.id}/${mine.number}.pdf`
  const bucket = [...store.objects.keys()].find((k) => k.endsWith(key))
  expect(bucket).toBeDefined()
  expect(store.types.get(bucket!)).toBe('application/pdf')
  expect(store.objects.get(bucket!)!.subarray(0, 5).toString()).toBe('%PDF-')
  for (const as of [p.uid, U.c1]) {
    const res = await call(pdf.GET, as, 'GET', undefined, { id: mine.id })
    expect([res.status, (await res.json()).url]).toEqual([200, expect.stringContaining(key)])
  }
})

it('the document never holds the street, only postcode and city', async () => {
  const p = await provider()
  const r = await request(p.id, U.c2, { address: { street: 'Hauptstr. 1', postcode: '10115', city: 'Berlin' } })
  const q = await quote(p, r)
  const draft = (await pool.query('SELECT draft::text t FROM quote_documents WHERE quote_id = $1', [q.id])).rows[0].t as string
  expect(draft).not.toContain('Hauptstr')
  expect(draft).toContain('10115 Berlin')
})

it('a revised quote keeps the number and adds _Rev.N; the next request takes the next number', async () => {
  const p = await provider()
  const r = await request(p.id, U.c1)
  const first = await quote(p, r)
  const second = await quote(p, r, 120)
  const third = await quote(p, r, 130)
  const numbers = (await listing(p.uid)).filter((d) => [first.id, second.id, third.id].includes(d.quoteId)).sort((a, b) => a.number.localeCompare(b.number)).map((d) => d.number)
  expect(numbers).toEqual([`${p.prefix}-0001`, `${p.prefix}-0001_Rev.1`, `${p.prefix}-0001_Rev.2`])
  const other = await request(p.id, U.c2)
  const next = await quote(p, other)
  expect((await listing(p.uid)).find((d) => d.quoteId === next.id)!.number).toBe(`${p.prefix}-0002`)
})

it('two quotes sent at the same moment get different numbers', async () => {
  const p = await provider()
  const [a, b] = await Promise.all([request(p.id, U.c1), request(p.id, U.c2)])
  const [qa, qb] = await Promise.all([quote(p, a), quote(p, b)])
  const nums = (await listing(p.uid)).filter((d) => [qa.id, qb.id].includes(d.quoteId)).map((d) => d.number).sort()
  expect(nums).toEqual([`${p.prefix}-0001`, `${p.prefix}-0002`])
})

it('a storage failure leaves no file: the link is 409 NOT_READY and the next sweep stores it', async () => {
  const p = await provider()
  const r = await request(p.id, U.c3)
  const down: Storage = { ...store, put: async () => Promise.reject(new Error('storage down')) }
  setStorageForTests(down)
  const q = await quote(p, r)
  const doc = (await listing(p.uid)).find((d) => d.quoteId === q.id)!
  expect(doc.pdfReady).toBe(false)
  const blocked = await call(pdf.GET, p.uid, 'GET', undefined, { id: doc.id })
  expect([blocked.status, (await blocked.json()).error]).toEqual([409, 'NOT_READY'])
  setStorageForTests(store)
  await storePendingQuoteDocuments(db)
  expect((await listing(p.uid)).find((d) => d.quoteId === q.id)!.pdfReady).toBe(true)
})

it('a quote whose document failed gets one later, and a revision still continues the first number', async () => {
  const p = await provider()
  const r = await request(p.id, U.c1)
  const v1 = await quote(p, r)
  const v2 = await quote(p, r, 120)
  await pool.query('DELETE FROM quote_documents WHERE quote_id IN ($1, $2)', [v1.id, v2.id]) // both after-commit steps "failed"
  await issueQuoteDocument(v2.id) // the later version is issued first by mistake: version 1 is numbered before it
  const nums = Object.fromEntries((await listing(p.uid)).filter((d) => [v1.id, v2.id].includes(d.quoteId)).map((d) => [d.quoteId, d.number]))
  // (deleting the rows by hand does not give the numbers back, so the base is the next free one; what counts is that v2 continues v1's number)
  expect(nums[v1.id]).toMatch(new RegExp('^' + p.prefix + '-[0-9]{4}$'))
  expect(nums[v2.id]).toBe(nums[v1.id] + '_Rev.1')
})

it('the sweep numbers a recent quote that has no document (older than 5 minutes)', async () => {
  const p = await provider()
  const r = await request(p.id, U.c2)
  const q = await quote(p, r)
  await pool.query('DELETE FROM quote_documents WHERE quote_id = $1', [q.id])
  await storePendingQuoteDocuments(db)
  expect((await listing(p.uid)).some((d) => d.quoteId === q.id)).toBe(false) // too fresh: its own after-commit step still owns it
  await pool.query("UPDATE quotes SET created_at = now() - interval '10 minutes' WHERE id = $1", [q.id])
  await storePendingQuoteDocuments(db)
  expect((await listing(p.uid)).find((d) => d.quoteId === q.id)).toMatchObject({ number: expect.stringMatching(new RegExp('^' + p.prefix + '-[0-9]{4}$')), pdfReady: true })
})

it('the data export lists the quote documents of the person', async () => {
  const p = await provider()
  const r = await request(p.id, U.c3)
  const q = await quote(p, r)
  const out = await (await call(exportRoute.GET, U.c3, 'GET')).json()
  expect(out.quoteDocuments).toEqual(expect.arrayContaining([expect.objectContaining({ quoteId: q.id, role: 'customer', number: `${p.prefix}-0001`, downloadUrl: expect.stringContaining('quotes/') })]))
})

it('deleting an account removes its quote documents and queues the PDFs for deletion', async () => {
  vi.stubEnv('DELETE_RETENTION_MONTHS', '0')
  const p = await provider()
  const r = await request(p.id, U.c5)
  const q = await quote(p, r)
  const doc = (await listing(U.c5)).find((d) => d.quoteId === q.id)!
  const key = `quotes/${p.id}/${doc.number}.pdf`
  const later: (() => unknown)[] = []
  await deleteAccount(U.c5, (fn) => void later.push(fn))
  expect((await pool.query('SELECT 1 FROM quote_documents WHERE quote_id = $1', [q.id])).rows).toHaveLength(0)
  expect((await pool.query('SELECT 1 FROM pending_object_deletes WHERE key = $1', [key])).rows).toHaveLength(1) // owed until the files are removed
  for (const fn of later) await fn() // the after-commit step removes the file and the owed row
  expect([...store.objects.keys()].some((k) => k.endsWith(key))).toBe(false)
  expect((await pool.query('SELECT 1 FROM pending_object_deletes WHERE key = $1', [key])).rows).toHaveLength(0)
  vi.unstubAllEnvs()
})

it('a third user sees no quotes and gets 404 on the link', async () => {
  const p = await provider()
  const r = await request(p.id, U.c4)
  const q = await quote(p, r)
  expect((await listing(U.third)).some((d) => d.quoteId === q.id)).toBe(false)
  const doc = (await listing(p.uid)).find((d) => d.quoteId === q.id)!
  expect((await call(pdf.GET, U.third, 'GET', undefined, { id: doc.id })).status).toBe(404)
})
