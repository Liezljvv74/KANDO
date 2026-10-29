import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { pool } from '@kando/db'
import { MessageSchema, RequestSchema, ThreadSchema } from '@kando/contract'
import { clearOutbox, notifyNewMessage, outboxForTests } from '@kando/domain'
import { call, cleanupUsers, EMAIL, seedBase, seedProvider, seedUser } from './helpers'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const threadsRoute = await import('../app/app-api/v1/threads/route')
const messagesRoute = await import('../app/app-api/v1/threads/[id]/messages/route')
const reportRoute = await import('../app/app-api/v1/messages/[id]/report/route')
const blocksRoute = await import('../app/app-api/v1/blocks/route')
const blockOne = await import('../app/app-api/v1/blocks/[userId]/route')
const requests = await import('../app/app-api/v1/requests/route')
const bookingsRoute = await import('../app/app-api/v1/bookings/route')

const U = { cust: 'cs-cust', owner: 'cs-owner', third: 'cs-third', other: 'cs-other' }
let pOwner: string, sOwner: string

beforeAll(async () => {
  await cleanupUsers()
  const { categoryId } = await seedBase()
  for (const u of [U.cust, U.third, U.other]) await seedUser(u)
  pOwner = await seedProvider(U.owner, { name: 'Cs Owner', categoryId })
  sOwner = (await pool.query('SELECT id FROM services WHERE provider_id = $1', [pOwner])).rows[0].id
})
afterAll(cleanupUsers)

const newRequest = async (as = U.cust) => RequestSchema.parse(await (await call(requests.POST, as, 'POST', { providerId: pOwner, description: 'Fix the fence' })).json())
const threadOf = async (as: string, requestId: string) => ThreadSchema.array().parse((await (await call(threadsRoute.GET, as)).json()).docs).find((t) => t.requestId === requestId)!
const send = (thread: string, as: string, body: string) => call(messagesRoute.POST, as, 'POST', { body }, { id: thread })
const sendOk = async (thread: string, as: string, body: string) => MessageSchema.parse(await (await send(thread, as, body)).json())
const report = (id: string, as: string, reason = 'rude') => call(reportRoute.POST, as, 'POST', { reason }, { id })
const block = (as: string, userId: string) => call(blocksRoute.POST, as, 'POST', { userId })
const unblock = (as: string, userId: string) => call(blockOne.DELETE, as, 'DELETE', undefined, { userId })

it('reporting a message creates one staff flag; reporting it twice does not add another', async () => {
  const t = await threadOf(U.cust, (await newRequest()).id)
  const m = await sendOk(t.id, U.cust, 'You are an idiot')
  expect((await report(m.id, U.owner, 'abusive')).status).toBe(204)
  expect((await report(m.id, U.owner, 'abusive again')).status).toBe(204)
  const rows = (await pool.query("SELECT user_id, note FROM staff_flags WHERE kind = 'message-reported' AND ref_id = $1", [m.id])).rows
  expect(rows).toEqual([{ user_id: U.owner, note: 'abusive' }])
  // the reason is staff-only: the reported person never sees it
  const theirs = await messagesRoute.GET(new Request('http://localhost/x', { headers: { cookie: `uid=${U.cust}:${EMAIL(U.cust)}` } }), { params: Promise.resolve({ id: t.id }) })
  expect(JSON.stringify(await theirs.json())).not.toContain('abusive')
})

it('a user cannot report their own message (400) or one in another thread (404)', async () => {
  const t = await threadOf(U.cust, (await newRequest()).id)
  const m = await sendOk(t.id, U.cust, 'Hello')
  expect((await report(m.id, U.cust)).status).toBe(400)
  expect((await report(m.id, U.third)).status).toBe(404)
  expect((await report('not-a-uuid', U.owner)).status).toBe(404)
  expect((await call(reportRoute.POST, U.owner, 'POST', { reason: '' }, { id: m.id })).status).toBe(400)
  expect((await pool.query("SELECT count(*)::int n FROM staff_flags WHERE kind = 'message-reported' AND ref_id = $1", [m.id])).rows[0].n).toBe(0)
})

it('after a block, neither side can send (403 BLOCKED) and the thread says blocked: true', async () => {
  const t = await threadOf(U.cust, (await newRequest()).id)
  expect((await block(U.owner, U.cust)).status).toBe(204)
  expect((await block(U.owner, U.cust)).status).toBe(204) // idempotent
  expect((await send(t.id, U.cust, 'hi')).status).toBe(403)
  expect(await (await send(t.id, U.owner, 'hi')).json()).toEqual({ error: 'BLOCKED' })
  expect((await threadOf(U.cust, t.requestId!)).blocked).toBe(true)
  expect((await threadOf(U.owner, t.requestId!)).blocked).toBe(true)
  const mine = await (await call(blocksRoute.GET, U.owner)).json()
  expect(mine.docs).toEqual([{ userId: U.cust, name: expect.any(String) }])
  expect(JSON.stringify(mine)).not.toContain('@')
  expect((await (await call(blocksRoute.GET, U.cust)).json()).docs).toEqual([]) // the blocked person sees nothing
  await unblock(U.owner, U.cust)
})

it("a blocked customer cannot create a request to the blocker's provider (404)", async () => {
  await newRequest()
  await block(U.owner, U.cust)
  const res = await call(requests.POST, U.cust, 'POST', { providerId: pOwner, description: 'Another job' })
  expect([res.status, await res.json()]).toEqual([404, { error: 'Not found' }])
  const direct = await call(bookingsRoute.POST, U.cust, 'POST', { serviceId: sOwner, startAt: new Date(Date.now() + 9 * 86_400_000).toISOString(), durationMin: 60, onSite: true, address: { postcode: '10115' } })
  expect([direct.status, await direct.json()]).toEqual([404, { error: 'Not found' }])
  const control = await call(bookingsRoute.POST, U.third, 'POST', { serviceId: sOwner, startAt: new Date(Date.now() + 9 * 86_400_000).toISOString(), durationMin: 60, onSite: true, address: { postcode: '10115' } })
  expect(control.status).toBe(201) // the same booking by an unblocked user works
  expect((await call(requests.POST, U.third, 'POST', { providerId: pOwner, description: 'Third job' })).status).toBe(201) // others are not affected
  await unblock(U.owner, U.cust)
})

it('blocking is only for someone you share a thread with (404)', async () => {
  await newRequest()
  expect((await block(U.other, U.owner)).status).toBe(404)
  expect((await block(U.cust, U.other)).status).toBe(404)
  expect((await block(U.cust, U.cust)).status).toBe(404)
})

it('unblock restores sending', async () => {
  const t = await threadOf(U.cust, (await newRequest()).id)
  await block(U.cust, U.owner) // the customer blocks the provider
  expect((await send(t.id, U.owner, 'hi')).status).toBe(403)
  expect((await unblock(U.cust, U.owner)).status).toBe(204)
  expect((await unblock(U.cust, U.owner)).status).toBe(204) // idempotent
  expect((await send(t.id, U.owner, 'hi again')).status).toBe(201)
  expect((await threadOf(U.cust, t.requestId!)).blocked).toBe(false)
})

it('two messages within 30 minutes send one email; one after 31 minutes sends another', async () => {
  const t = await threadOf(U.cust, (await newRequest()).id)
  await pool.query('DELETE FROM notifications WHERE user_id = $1', [U.owner])
  clearOutbox()
  const mails = (to: string) => outboxForTests().filter((m) => m.to === EMAIL(to))
  const rows = async () => (await pool.query("SELECT payload FROM notifications WHERE user_id = $1 AND kind = 'message-received'", [U.owner])).rows
  await sendOk(t.id, U.cust, 'First secret message text')
  await sendOk(t.id, U.cust, 'Second one')
  expect(mails(U.owner)).toHaveLength(1)
  expect(mails(U.owner)[0]!.text).not.toContain('secret')
  expect(mails(U.owner)[0]!.html).not.toContain('secret')
  expect(await rows()).toEqual([{ payload: { url: expect.stringContaining(t.id), threadId: t.id } }])
  // 29 minutes ago: still throttled (the exact boundary is the next test); 31 minutes ago: another one
  await pool.query("UPDATE notifications SET created_at = now() - interval '29 minutes' WHERE user_id = $1", [U.owner])
  await sendOk(t.id, U.cust, 'Third')
  expect(mails(U.owner)).toHaveLength(1)
  await pool.query("UPDATE notifications SET created_at = now() - interval '31 minutes' WHERE user_id = $1", [U.owner])
  await sendOk(t.id, U.cust, 'Fourth')
  expect(mails(U.owner)).toHaveLength(2)
  expect(await rows()).toHaveLength(2)
  // the other direction is its own recipient
  await sendOk(t.id, U.owner, 'Reply')
  expect(mails(U.cust).some((m) => m.subject.length > 0)).toBe(true)
})

it('the throttle boundary: exactly 30 minutes sends, 29:59.999 does not (controlled time)', async () => {
  const t = await threadOf(U.cust, (await newRequest()).id)
  const thread = { id: t.id, customerId: U.cust, providerId: pOwner }
  const at = new Date('2026-03-01T10:00:00.000Z')
  const count = async () => (await pool.query("SELECT count(*)::int n FROM notifications WHERE user_id = $1 AND kind = 'message-received' AND payload->>'threadId' = $2", [U.owner, t.id])).rows[0].n
  const notice = (now: Date) => notifyNewMessage((fn) => void pending.push(fn), thread, U.cust, now)
  const pending: (() => Promise<void>)[] = []
  const run = async () => { for (const fn of pending.splice(0)) await fn() }
  await pool.query('DELETE FROM notifications WHERE user_id = $1', [U.owner])
  await pool.query("INSERT INTO notifications (user_id, kind, payload, created_at) VALUES ($1, 'message-received', $2, $3)", [U.owner, JSON.stringify({ url: 'skilled://threads/x', threadId: t.id }), at])
  notice(new Date(at.getTime() + 30 * 60_000 - 1))
  await run()
  expect(await count()).toBe(1)
  notice(new Date(at.getTime() + 30 * 60_000))
  await run()
  expect(await count()).toBe(2)
})
