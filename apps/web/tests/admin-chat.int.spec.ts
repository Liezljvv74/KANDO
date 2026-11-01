import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { pool } from '@kando/db'
import { MessageSchema, RequestSchema, ThreadSchema } from '@kando/contract'
import { requestTime, adminCall, call, cleanupUsers, EMAIL, fakeSession, mockAuth, seedBase, seedProvider, seedUser, relaxLimits } from './helpers'

vi.mock('../lib/auth/server', async () => ({ ...(await mockAuth()), sessionFromRequest: fakeSession }))
const threadsRoute = await import('../app/app-api/v1/threads/route')
const messagesRoute = await import('../app/app-api/v1/threads/[id]/messages/route')
const reportRoute = await import('../app/app-api/v1/messages/[id]/report/route')
const requests = await import('../app/app-api/v1/requests/route')
const list = await import('../app/api/admin/[resource]/route')
const item = await import('../app/api/admin/[resource]/[id]/route')
const thread = await import('../app/api/admin/threads/[id]/route')
const resolve = await import('../app/api/admin/flags/[id]/resolve/route')

const U = { admin: 'ac-admin', rev: 'ac-rev', cust: 'ac-cust', owner: 'ac-owner', cust2: 'ac-cust2' }
let pOwner: string

beforeAll(async () => {
  await cleanupUsers()
  const { categoryId } = await seedBase()
  await seedUser(U.admin, 'admin')
  await seedUser(U.rev, 'reviewer')
  await seedUser(U.cust, null, 'Cora Customer')
  await seedUser(U.cust2)
  pOwner = await seedProvider(U.owner, { name: 'Ac Owner', categoryId })
})
afterAll(cleanupUsers)

const newThread = async (as = U.cust) => {
  await relaxLimits(as)
  const r = RequestSchema.parse(await (await call(requests.POST, as, 'POST', { providerId: pOwner, description: 'Fix the fence', ...requestTime() })).json())
  return ThreadSchema.array().parse((await (await call(threadsRoute.GET, as)).json()).docs).find((t) => t.requestId === r.id)!
}
const send = (threadId: string, as: string, body: string) => call(messagesRoute.POST, as, 'POST', { body }, { id: threadId })
const sendOk = async (threadId: string, as: string, body: string) => MessageSchema.parse(await (await send(threadId, as, body)).json())
const staffThread = (as: string, id: string) => adminCall(thread.GET, as, 'GET', '/x', undefined, { id })
const flagsList = (as: string) => adminCall(list.GET, as, 'GET', '/x', undefined, { resource: 'flags' })
const flagOf = async (kind: string, refId: string) => (await pool.query('SELECT id FROM staff_flags WHERE kind = $1 AND ref_id = $2', [kind, refId])).rows[0].id as string

it('staff read a thread with a reported message', async () => {
  const t = await newThread()
  const m = await sendOk(t.id, U.cust, 'You are an idiot')
  await sendOk(t.id, U.owner, 'Calm down')
  expect((await call(reportRoute.POST, U.owner, 'POST', { reason: 'abusive' }, { id: m.id })).status).toBe(204)
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  const res = await staffThread(U.rev, t.id)
  const lines = log.mock.calls.map((c) => String(c[0]))
  log.mockRestore()
  expect(res.status).toBe(200)
  const { data } = await res.json()
  expect(data.map((x: { body: string }) => x.body)).toEqual(['You are an idiot', 'Calm down'])
  expect(data[0]).toMatchObject({ senderId: U.cust, senderName: 'Cora Customer', senderRole: 'customer' })
  expect(data[0].reports).toEqual([{ flagId: expect.any(String), reason: 'abusive', reporterId: U.owner, reporterName: EMAIL(U.owner), reporterEmail: EMAIL(U.owner), resolved: false }])
  expect(data[1].reports).toEqual([])
  // every staff read leaves an audit line (ids only)
  const audit = lines.map((l) => { try { return JSON.parse(l) } catch { return null } }).find((l) => l?.audit === 'staff-thread-read')
  expect(audit).toMatchObject({ staffId: U.rev, threadId: t.id })
  expect(JSON.stringify(audit)).not.toContain('idiot')
  // still readable once the flag is resolved
  await adminCall(resolve.POST, U.admin, 'POST', '/x', undefined, { id: data[0].reports[0].flagId })
  expect((await staffThread(U.rev, t.id)).status).toBe(200)
})

it('staff get 404 for a thread with no reason', async () => {
  const t = await newThread(U.cust2)
  await sendOk(t.id, U.cust2, 'Hello there')
  for (const as of [U.rev, U.admin]) {
    const res = await staffThread(as, t.id)
    expect([res.status, await res.json()]).toEqual([404, { error: 'Not found' }])
  }
  // same answer for an id that does not exist, and for a thread whose only flag is a contact-attempts one
  expect((await staffThread(U.admin, '00000000-0000-0000-0000-000000000009')).status).toBe(404)
  expect((await staffThread(U.admin, 'nope')).status).toBe(404)
  expect((await staffThread('', t.id)).status).toBe(401)
  expect((await staffThread(U.cust, t.id)).status).toBe(403)
})

it('a reviewer lists flags; only an administrator resolves one', async () => {
  const t = await newThread()
  const m = await sendOk(t.id, U.cust, 'Rude words')
  await call(reportRoute.POST, U.owner, 'POST', { reason: 'rude' }, { id: m.id })
  const id = await flagOf('message-reported', m.id)
  const rows = (await (await flagsList(U.rev)).json()).data as { id: string; kind: string; reporterEmail: string; createdAt: string; resolvedAt: string | null; threadId: string | null }[]
  // user_id of a message-reported flag is the REPORTER; the person concerned is the sender of the message
  expect(rows.find((r) => r.id === id)).toMatchObject({ kind: 'message-reported', reporterEmail: EMAIL(U.owner), concernedEmail: EMAIL(U.cust), resolvedAt: null, threadId: t.id })
  expect((await adminCall(item.GET, U.rev, 'GET', '/x', undefined, { resource: 'flags', id })).status).toBe(200)
  // a reviewer cannot resolve; nothing changes
  expect((await adminCall(resolve.POST, U.rev, 'POST', '/x', undefined, { id })).status).toBe(403)
  expect((await adminCall(resolve.POST, '', 'POST', '/x', undefined, { id })).status).toBe(401)
  expect((await pool.query('SELECT resolved_at FROM staff_flags WHERE id = $1', [id])).rows[0].resolved_at).toBeNull()
  expect((await adminCall(resolve.POST, U.admin, 'POST', '/x', undefined, { id })).status).toBe(204)
  const row = (await pool.query('SELECT resolved_at, resolved_by FROM staff_flags WHERE id = $1', [id])).rows[0]
  expect(row.resolved_at).not.toBeNull()
  expect(row.resolved_by).toBe(U.admin)
  // resolving again keeps the first resolver; an unknown id is 404
  expect((await adminCall(resolve.POST, U.admin, 'POST', '/x', undefined, { id })).status).toBe(204)
  expect((await adminCall(resolve.POST, U.admin, 'POST', '/x', undefined, { id: '00000000-0000-0000-0000-000000000009' })).status).toBe(404)
  const after = (await (await flagsList(U.rev)).json()).data as { id: string; resolvedAt: string | null }[]
  expect(after.find((r) => r.id === id)!.resolvedAt).not.toBeNull()
})

it('the contact-attempts flag shows the blocked texts to staff', async () => {
  const t = await newThread(U.cust2)
  for (const n of [1, 2, 3]) expect((await send(t.id, U.cust2, `call me 0151 2345678${n}`)).status).toBe(422)
  const id = await flagOf('contact-attempts', U.cust2)
  const res = await adminCall(item.GET, U.rev, 'GET', '/x', undefined, { resource: 'flags', id })
  const { data } = await res.json()
  expect(data).toMatchObject({ kind: 'contact-attempts', concernedEmail: EMAIL(U.cust2), reporterEmail: null })
  expect(data.attempts.map((a: { text: string }) => a.text).sort()).toEqual(['call me 0151 23456781', 'call me 0151 23456782', 'call me 0151 23456783'])
  // the texts are not attached to the thread, and the flag gives no way into it
  expect(data.threadId).toBeNull()
  expect((await staffThread(U.admin, t.id)).status).toBe(404)
})

const accessRows = async (threadId: string) => (await pool.query('SELECT staff_id, thread_id, flag_id, outcome FROM staff_access_log WHERE thread_id = $1 ORDER BY created_at', [threadId])).rows

it('every staff attempt on a thread is logged: one row for an allowed read, one for a denied one, never any text', async () => {
  const t = await newThread()
  const m = await sendOk(t.id, U.cust, 'Private words here')
  expect(await staffThread(U.rev, t.id).then((r) => r.status)).toBe(404)
  expect(await accessRows(t.id)).toEqual([{ staff_id: U.rev, thread_id: t.id, flag_id: null, outcome: 'denied' }])
  await call(reportRoute.POST, U.owner, 'POST', { reason: 'rude' }, { id: m.id })
  const flag = await flagOf('message-reported', m.id)
  expect((await staffThread(U.rev, t.id)).status).toBe(200)
  const rows = await accessRows(t.id)
  expect(rows).toHaveLength(2)
  expect(rows[1]).toEqual({ staff_id: U.rev, thread_id: t.id, flag_id: flag, outcome: 'allowed' })
  expect(JSON.stringify(rows)).not.toContain('Private')
  // an id that is not a uuid is not logged; an unknown uuid is
  expect((await staffThread(U.rev, 'nope')).status).toBe(404)
  const ghost = '00000000-0000-0000-0000-0000000000aa'
  expect((await staffThread(U.rev, ghost)).status).toBe(404)
  expect(await accessRows(ghost)).toEqual([{ staff_id: U.rev, thread_id: ghost, flag_id: null, outcome: 'denied' }])
  expect((await pool.query("SELECT count(*)::int n FROM staff_access_log WHERE thread_id = 'nope'")).rows[0].n).toBe(0)
  // a person without a staff role is stopped before anything is logged
  expect((await staffThread(U.cust, t.id)).status).toBe(403)
  expect(await accessRows(t.id)).toHaveLength(2)
})

it('a bad id gives 404, not 500, when resolving a flag', async () => {
  expect((await adminCall(resolve.POST, U.admin, 'POST', '/x', undefined, { id: 'nope' })).status).toBe(404)
})

it("the reported person's own view of the thread does not show who reported, or why", async () => {
  const t = await newThread()
  const m = await sendOk(t.id, U.cust, 'Something nasty')
  await call(reportRoute.POST, U.owner, 'POST', { reason: 'secret-reason' }, { id: m.id })
  const seen = JSON.stringify([
    await (await call(messagesRoute.GET, U.cust, 'GET', undefined, { id: t.id })).json(),
    await (await call(threadsRoute.GET, U.cust)).json(),
  ])
  for (const s of ['secret-reason', 'message-reported', 'staff_flag', EMAIL(U.owner), U.owner]) expect(seen).not.toContain(s)
})
