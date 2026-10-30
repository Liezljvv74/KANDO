import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { db, pool } from '@kando/db'
import { BookingSchema, RequestSchema, ThreadSchema } from '@kando/contract'
import { clearOutbox, clearPushOutbox, createAppRequest, notifyBookingEvent, outboxForTests, pushOutboxForTests, runDueTimers, sendPush, withPushBatch } from '@kando/domain'
import { call, cleanupUsers, EMAIL, fakeSession, relaxLimits, seedBase, seedProvider, seedUser } from './helpers'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const requests = await import('../app/app-api/v1/requests/route')
const threadsRoute = await import('../app/app-api/v1/threads/route')
const messagesRoute = await import('../app/app-api/v1/threads/[id]/messages/route')
const bookingsRoute = await import('../app/app-api/v1/bookings/route')
const answer = await import('../app/app-api/v1/bookings/[id]/answer/route')

const U = { cust: 'ps-cust', owner: 'ps-owner' }
const TOKEN = (s: string) => `ExponentPushToken[${s}]`
let prov: string, service: string
const pushes = (uid: string) => pushOutboxForTests().filter((m) => m.to.startsWith(TOKEN(uid).slice(0, -1)))
const mails = (uid: string) => outboxForTests().filter((m) => m.to === EMAIL(uid))
const rows = async (uid: string) => (await pool.query('SELECT kind FROM notifications WHERE user_id = $1', [uid])).rows.map((r) => r.kind)
const giveTokens = async (uid: string, n = 1) => {
  for (let i = 0; i < n; i++) await pool.query("INSERT INTO push_tokens (user_id, token, platform) VALUES ($1, $2, 'android')", [uid, TOKEN(`${uid}-${i}`)])
}
const newRequest = async (description = 'Bitte den Zaun reparieren') => {
  await relaxLimits(U.cust)
  return RequestSchema.parse(await (await call(requests.POST, U.cust, 'POST', { providerId: prov, description })).json())
}
const threadOf = async (as: string, requestId: string) => ThreadSchema.array().parse((await (await call(threadsRoute.GET, as)).json()).docs).find((t) => t.requestId === requestId)!

beforeAll(async () => {
  await cleanupUsers()
  const { categoryId } = await seedBase()
  await seedUser(U.cust)
  prov = await seedProvider(U.owner, { name: 'Ps Owner', categoryId })
  service = (await pool.query('SELECT id FROM services WHERE provider_id = $1', [prov])).rows[0].id
})
beforeEach(async () => {
  vi.stubEnv('RESEND_API_KEY', '')
  await pool.query("DELETE FROM push_tokens WHERE user_id LIKE 'ps-%'")
  await pool.query("DELETE FROM notifications WHERE user_id LIKE 'ps-%'")
  await pool.query("UPDATE users SET language = 'de', push_chat = true, push_reminders = true, suspended_until = NULL WHERE id LIKE 'ps-%'")
  clearOutbox()
  clearPushOutbox()
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})
afterAll(cleanupUsers)

it('one event: one in-app row, one email, one push to each device', async () => {
  await giveTokens(U.owner, 2)
  const r = await newRequest('Geheime Beschreibung')
  expect(await rows(U.owner)).toEqual(['request-received'])
  expect(mails(U.owner)).toHaveLength(1)
  const p = pushes(U.owner)
  expect(p.map((m) => m.to).sort()).toEqual([TOKEN(`${U.owner}-0`), TOKEN(`${U.owner}-1`)])
  expect(p[0]).toMatchObject({ title: 'Neue Anfrage', data: { url: `skilled://bookings/request/${r.id}`, kind: 'request-received' } })
  expect(JSON.stringify(p)).not.toContain('Geheime')
  // English for an English user
  await pool.query("UPDATE users SET language = 'en' WHERE id = $1", [U.owner])
  clearPushOutbox()
  await newRequest()
  expect(pushes(U.owner)[0]!.title).toBe('New request')
})

it('chat switch off: no push for messages (the email goes instead), still for bookings', async () => {
  await giveTokens(U.owner)
  await pool.query('UPDATE users SET push_chat = false WHERE id = $1', [U.owner])
  const r = await newRequest()
  expect(pushes(U.owner).map((m) => m.data.kind)).toEqual(['request-received'])
  clearPushOutbox()
  clearOutbox()
  const t = await threadOf(U.cust, r.id)
  expect((await call(messagesRoute.POST, U.cust, 'POST', { body: 'Hallo' }, { id: t.id })).status).toBe(201)
  expect(await rows(U.owner)).toContain('message-received')
  expect(pushes(U.owner)).toEqual([])
  // a token alone is not a reason to stay silent: no push reaches them, so the email does
  expect(mails(U.owner).map((m) => m.subject)).toEqual(['Du hast eine neue Nachricht'])
})

it('reminders switch off: no payment-reminder push', async () => {
  await giveTokens(U.cust)
  await notifyBookingEvent('payment-reminder', U.cust, {})
  expect(pushes(U.cust).map((m) => m.data.kind)).toEqual(['payment-reminder'])
  clearPushOutbox()
  await pool.query('UPDATE users SET push_reminders = false WHERE id = $1', [U.cust])
  await notifyBookingEvent('payment-reminder', U.cust, {})
  await notifyBookingEvent('confirm-reminder', U.cust, {})
  await notifyBookingEvent('quote-expiring', U.cust, {})
  expect(pushes(U.cust)).toEqual([])
  expect(mails(U.cust)).toHaveLength(4) // the emails still go out
  await notifyBookingEvent('booking-accepted', U.cust, { bookingId: crypto.randomUUID() })
  expect(pushes(U.cust).map((m) => m.data.kind)).toEqual(['booking-accepted'])
})

it('a message to a person with a token sends push and no email; without a token, an email', async () => {
  await giveTokens(U.owner)
  const t = await threadOf(U.cust, (await newRequest()).id)
  clearOutbox()
  clearPushOutbox()
  expect((await call(messagesRoute.POST, U.cust, 'POST', { body: 'Meine Nummer ist geheim' }, { id: t.id })).status).toBe(201)
  const p = pushes(U.owner)
  expect(p).toHaveLength(1)
  expect(p[0]!.data.url).toBe(`skilled://threads/${t.id}`)
  expect(JSON.stringify(p)).not.toContain('geheim')
  expect(mails(U.owner)).toEqual([])
  // the customer has no token: the reply reaches them by email
  expect((await call(messagesRoute.POST, U.owner, 'POST', { body: 'Antwort' }, { id: t.id })).status).toBe(201)
  expect(mails(U.cust).map((m) => m.subject)).toEqual(['Du hast eine neue Nachricht'])
  expect(pushes(U.cust)).toEqual([])
})

it('DeviceNotRegistered removes the token; 101 devices go in chunks of 100 with the access token', async () => {
  vi.stubEnv('VITEST', '')
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('EXPO_ACCESS_TOKEN', 'test-access')
  await giveTokens(U.cust, 101)
  const dead = TOKEN(`${U.cust}-7`)
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const sent = JSON.parse(String(init.body)) as { to: string }[]
    return Response.json({ data: sent.map((m) => (m.to === dead ? { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } } : { status: 'ok', id: 'x' })) })
  })
  vi.stubGlobal('fetch', fetch)
  await sendPush(U.cust, { kind: 'booking-accepted', title: 'T', body: 'B', url: 'skilled://bookings/x' })
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(fetch.mock.calls.map(([, init]) => (JSON.parse(String(init.body)) as unknown[]).length)).toEqual([100, 1])
  expect(fetch.mock.calls[0]![0]).toBe('https://exp.host/--/api/v2/push/send')
  expect(new Headers(fetch.mock.calls[0]![1].headers).get('authorization')).toBe('Bearer test-access')
  const left = (await pool.query('SELECT token FROM push_tokens WHERE user_id = $1', [U.cust])).rows.map((r) => r.token)
  expect(left).toHaveLength(100)
  expect(left).not.toContain(dead)
  expect(pushOutboxForTests()).toEqual([]) // the network path, not the test outbox
})

it('a malformed answer for one chunk does not stop the next chunk', async () => {
  vi.stubEnv('VITEST', '')
  vi.stubEnv('NODE_ENV', 'production')
  await giveTokens(U.cust, 101)
  let n = 0
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    if (n++ === 0) return new Response('not json', { status: 200 })
    const sent = JSON.parse(String(init.body)) as unknown[]
    return Response.json({ data: sent.map(() => ({ status: 'error', details: { error: 'DeviceNotRegistered' } })) })
  })
  vi.stubGlobal('fetch', fetch)
  await expect(sendPush(U.cust, { kind: 'booking-paid', title: 'T', body: 'B', url: 'x' })).resolves.toBeUndefined()
  expect(fetch).toHaveBeenCalledTimes(2)
  // the second chunk's one dead device was removed; the first chunk's tokens stay
  expect((await pool.query('SELECT count(*)::int n FROM push_tokens WHERE user_id = $1', [U.cust])).rows[0].n).toBe(100)
})

it('a failing push never fails the event: the row is stored and nothing throws', async () => {
  vi.stubEnv('VITEST', '')
  vi.stubEnv('NODE_ENV', 'production')
  await giveTokens(U.cust)
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
  await expect(notifyBookingEvent('booking-accepted', U.cust, { bookingId: crypto.randomUUID() })).resolves.toBeUndefined()
  expect(await rows(U.cust)).toEqual(['booking-accepted'])
  vi.stubGlobal('fetch', vi.fn(async () => new Response('bad gateway', { status: 502 })))
  await expect(sendPush(U.cust, { kind: 'booking-paid', title: 'T', body: 'B', url: 'x' })).resolves.toBeUndefined()
  expect((await pool.query('SELECT count(*)::int n FROM push_tokens WHERE user_id = $1', [U.cust])).rows[0].n).toBe(1)
})

it('no push before the commit, none after a rollback', async () => {
  await giveTokens(U.cust)
  const appRequest = createAppRequest(fakeSession)
  let seenInside = -1
  const ok = appRequest({ auth: 'required' }, async ({ afterCommit }) => {
    afterCommit(() => notifyBookingEvent('booking-accepted', U.cust, { bookingId: crypto.randomUUID() }))
    seenInside = pushOutboxForTests().length
    return Response.json({})
  })
  const failing = appRequest({ auth: 'required' }, async ({ afterCommit }) => {
    afterCommit(() => notifyBookingEvent('booking-declined', U.cust, { bookingId: crypto.randomUUID() }))
    throw new Error('boom')
  })
  expect((await call(failing, U.cust, 'POST', {})).status).toBe(500)
  expect(pushes(U.cust)).toEqual([])
  expect(await rows(U.cust)).toEqual([])
  expect((await call(ok, U.cust, 'POST', {})).status).toBe(200)
  expect(seenInside).toBe(0)
  expect(pushes(U.cust).map((m) => m.data.kind)).toEqual(['booking-accepted'])
})

it('a suspended person still gets booking pushes; an unknown or deleted account gets none and nothing throws', async () => {
  await giveTokens(U.cust)
  await pool.query("UPDATE users SET suspended_until = now() + interval '10 days' WHERE id = $1", [U.cust])
  await notifyBookingEvent('refund-issued', U.cust, { bookingId: crypto.randomUUID(), reason: 'x' })
  expect(pushes(U.cust).map((m) => m.data.kind)).toEqual(['refund-issued'])
  await expect(sendPush('ps-nobody', { kind: 'booking-paid', title: 'T', body: 'B', url: 'x' })).resolves.toBeUndefined()
  await expect(notifyBookingEvent('booking-paid', 'ps-nobody', {})).resolves.toBeUndefined()
  expect(pushOutboxForTests()).toHaveLength(1)
})

it('a timer reminder pushes once; the next run sends nothing again', async () => {
  await giveTokens(U.cust)
  const b = BookingSchema.parse(await (await call(bookingsRoute.POST, U.cust, 'POST', { serviceId: service, startAt: new Date(Date.now() + 40 * 86_400_000).toISOString(), durationMin: 60, onSite: true, address: { postcode: '10115' } })).json())
  await call(answer.POST, U.owner, 'POST', { type: 'accept' }, { id: b.id })
  clearPushOutbox()
  const payBy = (await pool.query('SELECT pay_by FROM bookings WHERE id = $1', [b.id])).rows[0].pay_by as Date
  const at = new Date(payBy.getTime() - 3_600_000)
  await runDueTimers(db, at)
  await runDueTimers(db, at)
  expect(pushes(U.cust).map((m) => [m.data.kind, m.data.url])).toEqual([['payment-reminder', `skilled://bookings/${b.id}`]])
})

it('inside a push batch (the cron) pushes are held back and sent together at its end', async () => {
  await giveTokens(U.cust, 2)
  clearPushOutbox()
  await withPushBatch(async () => {
    await sendPush(U.cust, { kind: 'booking-paid', title: 'T', body: 'B', url: 'skilled://my-profile' })
    await sendPush(U.cust, { kind: 'booking-paid', title: 'T2', body: 'B2', url: 'skilled://my-profile' })
    expect(pushes(U.cust)).toEqual([]) // nothing sent yet
  })
  expect(pushes(U.cust).map((m) => m.title)).toEqual(['T', 'T', 'T2', 'T2'])
})
