import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { pool } from '@kando/db'
import { RequestSchema } from '@kando/contract'
import { call, cleanupUsers, relaxLimits, seedBase, seedProvider, seedUser } from './helpers'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const requests = await import('../app/app-api/v1/requests/route')
const requestOne = await import('../app/app-api/v1/requests/[id]/route')
const revise = await import('../app/app-api/v1/requests/[id]/revise/route')
const quotes = await import('../app/app-api/v1/requests/[id]/quotes/route')
const withdraw = await import('../app/app-api/v1/requests/[id]/withdraw/route')

const U = { cust: 'rt-cust', owner: 'rt-owner', remote: 'rt-remote', third: 'rt-third' }
let pOwner: string, pRemote: string

beforeAll(async () => {
  await cleanupUsers()
  const { categoryId } = await seedBase()
  for (const u of [U.cust, U.third]) await seedUser(u)
  pOwner = await seedProvider(U.owner, { name: 'Rt Owner', categoryId })
  pRemote = await seedProvider(U.remote, { name: 'Rt Remote', categoryId, remote: true })
})
afterAll(cleanupUsers)

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString()
const time = (extra: object = {}) => ({ startAt: day(10), durationMin: 120, onSite: true, address: { street: 'Hauptstr. 1', postcode: '10115', city: 'Berlin' }, note: 'Back door', ...extra })
const send = async (body: object = {}, providerId = pOwner, as = U.cust) => {
  await relaxLimits(as)
  return call(requests.POST, as, 'POST', { providerId, description: 'Fix the fence', ...body })
}
const created = async (body: object = time(), providerId = pOwner) => RequestSchema.parse(await (await send(body, providerId)).json())
const noticesOf = async (user: string, kind: string) => (await pool.query('SELECT count(*)::int n FROM notifications WHERE user_id = $1 AND kind = $2', [user, kind])).rows[0].n
const said = (requestId: string, sender: string, body = 'Hello') =>
  pool.query("INSERT INTO messages (thread_id, sender_id, kind, body) SELECT id, $2, 'text', $3 FROM threads WHERE request_id = $1", [requestId, sender, body])

it('a request stores the time, duration, place and note; the provider is told', async () => {
  const r = await created()
  expect(r).toMatchObject({ status: 'open', durationMin: 120, onSite: true, note: 'Back door', revision: 0 })
  expect(new Date(r.startAt!).getTime()).toBeGreaterThan(Date.now())
  expect(await noticesOf(U.owner, 'request-received')).toBeGreaterThan(0)
})

it('a request without a time is refused with time-required', async () => {
  const res = await send({})
  expect(res.status).toBe(400)
  expect((await res.json()).error).toBe('time-required')
})

it('a past time, a too-far time and a remote time for an on-site provider are refused', async () => {
  const past = await send(time({ startAt: day(-1) }))
  expect([past.status, (await past.json()).error]).toEqual([400, 'start-in-past'])
  const far = await send(time({ startAt: day(500) }))
  expect([far.status, (await far.json()).error]).toEqual([400, 'start-too-far'])
  const remote = await send(time({ onSite: false, address: undefined }))
  expect([remote.status, (await remote.json()).error]).toEqual([400, 'on-site-required'])
  expect((await send(time({ onSite: false, address: undefined }), pRemote)).status).toBe(201)
})

it('the provider sees postcode and city of the job place but not the street; the customer sees all', async () => {
  const r = await created()
  const asProvider = RequestSchema.parse(await (await call(requestOne.GET, U.owner, 'GET', undefined, { id: r.id })).json())
  const asCustomer = RequestSchema.parse(await (await call(requestOne.GET, U.cust, 'GET', undefined, { id: r.id })).json())
  expect(asProvider.address).toEqual({ postcode: '10115', city: 'Berlin' })
  expect(asCustomer.address).toEqual({ street: 'Hauptstr. 1', postcode: '10115', city: 'Berlin' })
  const list = await requests.GET(new Request('http://localhost/app-api/v1/requests?role=provider', { headers: { cookie: `uid=${U.owner}:${U.owner}@test.skilled.invalid` } }), { params: Promise.resolve({}) })
  const mine = (await list.json()).docs.find((d: { id: string }) => d.id === r.id)
  expect(mine.address).toEqual({ postcode: '10115', city: 'Berlin' })
})

it('the customer revises the time: revision counts, the provider is told, and a sent quote is replaced', async () => {
  const r = await created()
  const q = await (await call(quotes.POST, U.owner, 'POST', { amount: 100, scope: 'Fence', startAt: r.startAt, durationMin: 120 }, { id: r.id })).json()
  const before = await noticesOf(U.owner, 'request-updated')
  const res = await call(revise.POST, U.cust, 'POST', time({ startAt: day(12) }), { id: r.id })
  expect(res.status).toBe(200)
  expect(RequestSchema.parse(await res.json())).toMatchObject({ revision: 1 })
  expect(await noticesOf(U.owner, 'request-updated')).toBe(before + 1)
  expect((await pool.query('SELECT status FROM quotes WHERE id = $1', [q.id])).rows[0].status).toBe('superseded')
  expect((await pool.query('SELECT status FROM requests WHERE id = $1', [r.id])).rows[0].status).toBe('open')
})

it('revising to the same time changes nothing', async () => {
  const r = await created()
  const res = await call(revise.POST, U.cust, 'POST', time({ startAt: r.startAt }), { id: r.id })
  expect(res.status).toBe(200)
  expect((await res.json()).revision).toBe(0)
})

it('before the provider proposed anything the customer may keep adjusting', async () => {
  const r = await created()
  for (const d of [12, 13, 14]) expect((await call(revise.POST, U.cust, 'POST', time({ startAt: day(d) }), { id: r.id })).status).toBe(200)
})

it('after the provider proposed another time, a change by the customer needs a chat message from the provider first', async () => {
  const r = await created()
  await pool.query("INSERT INTO quotes (request_id, provider_id, version, amount, currency, scope, start_at, duration_min, proposed_other_time, expires_at) VALUES ($1, $2, 1, 100, 'EUR', 'Fence', now() + interval '11 days', 120, true, now() + interval '7 days')", [r.id, pOwner])
  const again = await call(revise.POST, U.cust, 'POST', time({ startAt: day(14) }), { id: r.id })
  expect(again.status).toBe(409)
  expect((await again.json()).error).toBe('chat-first')
  await said(r.id, U.owner)
  expect((await call(revise.POST, U.cust, 'POST', time({ startAt: day(14) }), { id: r.id })).status).toBe(200)
})

it('only the customer revises; a stranger gets 404; a closed request gets 409', async () => {
  const r = await created()
  expect((await call(revise.POST, U.owner, 'POST', time({ startAt: day(12) }), { id: r.id })).status).toBe(403)
  expect((await call(revise.POST, U.third, 'POST', time({ startAt: day(12) }), { id: r.id })).status).toBe(404)
  expect((await call(withdraw.POST, U.cust, 'POST', undefined, { id: r.id })).status).toBe(200)
  const closed = await call(revise.POST, U.cust, 'POST', time({ startAt: day(12) }), { id: r.id })
  expect([closed.status, (await closed.json()).error]).toEqual([409, 'request-closed'])
})
