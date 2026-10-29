import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { pool } from '@kando/db'
import { BookingSchema, MessageSchema, QuoteSchema, RequestSchema, ThreadSchema } from '@kando/contract'
import { setStorageForTests } from '@kando/domain'
import { call, cleanupUsers, EMAIL, memoryStorage, seedBase, seedProvider, seedUser } from './helpers'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const threadsRoute = await import('../app/app-api/v1/threads/route')
const messagesRoute = await import('../app/app-api/v1/threads/[id]/messages/route')
const photosRoute = await import('../app/app-api/v1/threads/[id]/photos/route')
const requests = await import('../app/app-api/v1/requests/route')
const quotes = await import('../app/app-api/v1/requests/[id]/quotes/route')
const accept = await import('../app/app-api/v1/quotes/[id]/accept/route')
const bookingsRoute = await import('../app/app-api/v1/bookings/route')

const U = { cust: 'ch-cust', owner: 'ch-owner', third: 'ch-third', spam: 'ch-spam' }
let pOwner: string, sOwner: string
const store = memoryStorage()

beforeAll(async () => {
  await cleanupUsers()
  setStorageForTests(store)
  const { categoryId } = await seedBase()
  for (const u of [U.cust, U.third, U.spam]) await seedUser(u)
  pOwner = await seedProvider(U.owner, { name: 'Ch Owner', categoryId })
  sOwner = (await pool.query('SELECT id FROM services WHERE provider_id = $1', [pOwner])).rows[0].id
})
afterAll(async () => {
  setStorageForTests(undefined)
  await cleanupUsers()
})

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString()
const newRequest = async (description = 'Fix the fence') => RequestSchema.parse(await (await call(requests.POST, U.cust, 'POST', { providerId: pOwner, description })).json())
const threadOf = async (as: string, requestId: string) => {
  const docs = ThreadSchema.array().parse((await (await call(threadsRoute.GET, as)).json()).docs)
  return docs.find((t) => t.requestId === requestId)!
}
const send = (thread: string, as: string, body: unknown) => call(messagesRoute.POST, as, 'POST', body, { id: thread })
const list = async (thread: string, as: string, after?: string) => {
  const url = `http://localhost/app-api/v1/x${after ? `?after=${encodeURIComponent(after)}` : ''}`
  const res = await messagesRoute.GET(new Request(url, { headers: { cookie: `uid=${as}:${EMAIL(as)}` } }), { params: Promise.resolve({ id: thread }) })
  return { status: res.status, docs: MessageSchema.array().parse((await res.json()).docs ?? []) }
}
const png = () => sharp({ create: { width: 20, height: 20, channels: 3, background: '#c00' } }).png().toBuffer()
const photoRequest = async (thread: string, as: string) => {
  const form = new FormData()
  form.set('file', new File([new Uint8Array(await png())], 'a.png', { type: 'image/png' }))
  return photosRoute.POST(new Request('http://localhost/app-api/v1/x', { method: 'POST', headers: { cookie: `uid=${as}:${EMAIL(as)}` }, body: form }), { params: Promise.resolve({ id: thread }) })
}

it('creating a request opens a thread; both parties list it', async () => {
  const r = await newRequest()
  const mine = await threadOf(U.cust, r.id)
  const theirs = await threadOf(U.owner, r.id)
  expect(mine.id).toBe(theirs.id)
  expect(mine).toMatchObject({ bookingId: null, blocked: false })
  expect(mine.otherName).not.toBe('')
  expect(mine.otherUserId).toBe(U.owner)
  expect(theirs.otherUserId).toBe(U.cust)
  expect(await threadOf(U.third, r.id)).toBeUndefined()
  expect((await pool.query('SELECT count(*)::int AS n FROM threads WHERE request_id = $1', [r.id])).rows[0].n).toBe(1)
})

it("a quote and its acceptance appear as cards in the request's thread", async () => {
  const r = await newRequest()
  const q = QuoteSchema.parse(await (await call(quotes.POST, U.owner, 'POST', { amount: 99.5, scope: 'Fence' }, { id: r.id })).json())
  const acc = await call(accept.POST, U.cust, 'POST', { startAt: day(10), durationMin: 120, onSite: true, address: { postcode: '10115' } }, { id: q.id })
  expect(acc.status).toBe(200)
  const t = await threadOf(U.cust, r.id)
  const cards = (await list(t.id, U.cust)).docs.filter((m) => m.kind === 'card')
  expect(cards.map((c) => c.card)).toEqual([
    { type: 'quote', refId: q.id, amount: 99.5, currency: 'EUR', version: 1 },
    { type: 'acceptance', refId: BookingSchema.parse(await acc.json()).id, amount: 99.5, currency: 'EUR' },
  ])
  expect(cards.map((c) => c.mine)).toEqual([false, true]) // the customer's view: the provider quoted, they accepted
  // a party cannot forge a card through the message route: the extra field is ignored
  expect((await send(t.id, U.cust, { body: 'hi', kind: 'card' })).status).toBe(201)
  expect((await pool.query("SELECT count(*)::int AS n FROM messages WHERE thread_id = $1 AND kind = 'card'", [t.id])).rows[0].n).toBe(2)
})

it("a booking from an accepted quote shares the request's thread; a direct booking gets its own", async () => {
  const r = await newRequest()
  const q = QuoteSchema.parse(await (await call(quotes.POST, U.owner, 'POST', { amount: 50, scope: 'Fence' }, { id: r.id })).json())
  const b = BookingSchema.parse(await (await call(accept.POST, U.cust, 'POST', { startAt: day(11), durationMin: 60, onSite: true, address: { postcode: '10115' } }, { id: q.id })).json())
  const t = await threadOf(U.cust, r.id)
  expect((await pool.query('SELECT count(*)::int AS n FROM threads WHERE booking_id = $1', [b.id])).rows[0].n).toBe(0)
  const { threadForBooking } = await import('@kando/domain')
  const { asUser } = await import('@kando/db')
  expect(await asUser(U.owner, (tx) => threadForBooking(tx, b.id))).toBe(t.id)
  const direct = BookingSchema.parse(await (await call(bookingsRoute.POST, U.cust, 'POST', { serviceId: sOwner, startAt: day(12), durationMin: 60, onSite: true, address: { postcode: '10115' } })).json())
  const own = (await pool.query('SELECT id, request_id FROM threads WHERE booking_id = $1', [direct.id])).rows
  expect(own).toHaveLength(1)
  expect(own[0].request_id).toBeNull()
  expect(own[0].id).not.toBe(t.id)
})

it('text message round trip; the other side sees mine: false', async () => {
  const t = await threadOf(U.cust, (await newRequest()).id)
  const res = await send(t.id, U.cust, { body: '  Hello there  ' })
  expect(res.status).toBe(201)
  expect(MessageSchema.parse(await res.json())).toMatchObject({ kind: 'text', body: 'Hello there', mine: true, photoUrl: null, card: null })
  expect((await list(t.id, U.owner)).docs.map((m) => [m.body, m.mine])).toContainEqual(['Hello there', false])
})

it('a message with a phone number is 422 CONTACT_DETAILS and nothing is stored', async () => {
  const t = await threadOf(U.cust, (await newRequest()).id)
  const res = await send(t.id, U.cust, { body: 'call me 0151 23456789' })
  expect(res.status).toBe(422)
  expect(await res.json()).toEqual({ error: 'CONTACT_DETAILS' })
  expect((await pool.query('SELECT count(*)::int AS n FROM messages WHERE thread_id = $1', [t.id])).rows[0].n).toBe(0)
  expect((await list(t.id, U.owner)).docs).toHaveLength(0) // the other side sees nothing of it
  expect((await pool.query('SELECT hit FROM contact_attempts WHERE thread_id = $1', [t.id])).rows).toEqual([{ hit: 'phone' }])
})

it('a request description or quote scope with an email is 422', async () => {
  const count = async () => (await pool.query('SELECT count(*)::int AS n FROM requests WHERE customer_id = $1', [U.cust])).rows[0].n
  const before = await count()
  const res = await call(requests.POST, U.cust, 'POST', { providerId: pOwner, description: 'write to me at max@example.com' })
  expect([res.status, await res.json()]).toEqual([422, { error: 'CONTACT_DETAILS' }])
  expect(await count()).toBe(before)
  const r = await newRequest()
  const q = await call(quotes.POST, U.owner, 'POST', { amount: 10, scope: 'mail max@example.com' }, { id: r.id })
  expect(q.status).toBe(422)
  expect((await pool.query('SELECT count(*)::int AS n FROM quotes WHERE request_id = $1', [r.id])).rows[0].n).toBe(0)
  const note = await call(bookingsRoute.POST, U.cust, 'POST', { serviceId: sOwner, startAt: day(13), durationMin: 60, onSite: true, address: { postcode: '10115' }, note: 'ring 0151 23456789' })
  expect(note.status).toBe(422)
})

it('three blocked attempts in a day create one staff flag', async () => {
  const r = await call(requests.POST, U.spam, 'POST', { providerId: pOwner, description: 'ok job' })
  const t = await threadOf(U.spam, RequestSchema.parse(await r.json()).id)
  for (let i = 0; i < 3; i++) expect((await send(t.id, U.spam, { body: `call 0151 2345678${i}` })).status).toBe(422)
  expect((await pool.query("SELECT count(*)::int AS n FROM staff_flags WHERE user_id = $1 AND kind = 'contact-attempts'", [U.spam])).rows[0].n).toBe(1)
  expect((await pool.query('SELECT count(*)::int AS n FROM contact_attempts WHERE user_id = $1', [U.spam])).rows[0].n).toBe(3)
  expect((await send(t.id, U.spam, { body: 'call 0151 23456789' })).status).toBe(422)
  expect((await pool.query('SELECT count(*)::int AS n FROM staff_flags WHERE user_id = $1', [U.spam])).rows[0].n).toBe(1) // still one open flag
})

it('a photo is stored in the private bucket and listed with a signed link', async () => {
  const t = await threadOf(U.cust, (await newRequest()).id)
  const res = await photoRequest(t.id, U.cust)
  expect(res.status).toBe(201)
  const m = MessageSchema.parse(await res.json())
  expect(m).toMatchObject({ kind: 'photo', mine: true, body: null })
  const key = (await pool.query('SELECT photo_key FROM messages WHERE id = $1', [m.id])).rows[0].photo_key as string
  expect(key).toMatch(new RegExp(`^chat/${t.id}/[0-9a-f-]+\\.jpg$`))
  expect(store.objects.has(`documents/${key}`)).toBe(true)
  expect(store.objects.has(`media/${key}`)).toBe(false)
  const seen = (await list(t.id, U.owner)).docs.find((x) => x.id === m.id)!
  expect(seen.photoUrl).toBe(`https://signed.test/documents/${key}?expires=600`)
  // a key outside the thread's own folder is never signed
  await pool.query("UPDATE messages SET photo_key = 'chat/other/x.jpg' WHERE id = $1", [m.id])
  expect((await list(t.id, U.owner)).docs.find((x) => x.id === m.id)!.photoUrl).toBeNull()
})

it('a 2001-character message is 400', async () => {
  const t = await threadOf(U.cust, (await newRequest()).id)
  expect((await send(t.id, U.cust, { body: 'a'.repeat(2001) })).status).toBe(400)
  expect((await send(t.id, U.cust, { body: 'a'.repeat(2000) })).status).toBe(201)
})

it('a third user gets 404 on list, send and photo', async () => {
  const t = await threadOf(U.cust, (await newRequest()).id)
  expect((await list(t.id, U.third)).status).toBe(404)
  expect((await send(t.id, U.third, { body: 'hi' })).status).toBe(404)
  expect((await photoRequest(t.id, U.third)).status).toBe(404)
  expect((await list(crypto.randomUUID(), U.cust)).status).toBe(404)
})

it('a blocked party gets 403 BLOCKED on send', async () => {
  const t = await threadOf(U.cust, (await newRequest()).id)
  await pool.query('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)', [U.owner, U.cust])
  const res = await send(t.id, U.cust, { body: 'hi' })
  expect([res.status, await res.json()]).toEqual([403, { error: 'BLOCKED' }])
  await pool.query('DELETE FROM blocks WHERE blocker_id = $1', [U.owner])
})

it('cursor pagination returns each message once', async () => {
  const t = await threadOf(U.cust, (await newRequest()).id)
  const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]
  const at = ['2026-01-01 10:00:00.123456+00', '2026-01-01 10:00:00.123456+00', '2026-01-01 10:00:01+00']
  for (const [i, id] of ids.entries()) await pool.query("INSERT INTO messages (id, thread_id, sender_id, kind, body, created_at) VALUES ($1, $2, $3, 'text', $4, $5)", [id, t.id, U.cust, `m${i}`, at[i]])
  const all = (await list(t.id, U.cust)).docs
  expect(all).toHaveLength(3)
  expect(all.map((m) => m.id).sort()).toEqual([...ids].sort())
  const seen = [all[0]!.id]
  for (let cursor = all[0]!; ; ) {
    const next = (await list(t.id, U.cust, `${cursor.createdAt}|${cursor.id}`)).docs
    if (!next.length) break
    seen.push(next[0]!.id)
    cursor = next[0]!
  }
  expect(seen).toEqual(all.map((m) => m.id))
  expect((await list(t.id, U.cust, 'nonsense')).status).toBe(400)
})

it('two first uses of a request thread at once give one thread', async () => {
  const { threadForRequest } = await import('@kando/domain')
  const { asUser } = await import('@kando/db')
  const id = (await pool.query("INSERT INTO requests (customer_id, provider_id, description, answer_by) VALUES ($1, $2, 'x', now() + interval '3 days') RETURNING id", [U.cust, pOwner])).rows[0].id as string
  const ids = await Promise.all([asUser(U.cust, (tx) => threadForRequest(tx, id)), asUser(U.owner, (tx) => threadForRequest(tx, id)), asUser(U.cust, (tx) => threadForRequest(tx, id))])
  expect(new Set(ids).size).toBe(1)
  expect((await pool.query('SELECT count(*)::int AS n FROM threads WHERE request_id = $1', [id])).rows[0].n).toBe(1)
})

it('an accept note with contact details is 422 and nothing changes', async () => {
  const r = await newRequest()
  const q = QuoteSchema.parse(await (await call(quotes.POST, U.owner, 'POST', { amount: 20, scope: 'Fence' }, { id: r.id })).json())
  const res = await call(accept.POST, U.cust, 'POST', { startAt: day(14), durationMin: 60, onSite: true, address: { postcode: '10115' }, note: 'mail max@example.com' }, { id: q.id })
  expect([res.status, await res.json()]).toEqual([422, { error: 'CONTACT_DETAILS' }])
  expect((await pool.query('SELECT status FROM quotes WHERE id = $1', [q.id])).rows[0].status).toBe('sent')
  expect((await pool.query('SELECT status FROM requests WHERE id = $1', [r.id])).rows[0].status).toBe('quoted')
  expect((await pool.query('SELECT count(*)::int AS n FROM bookings WHERE quote_id = $1', [q.id])).rows[0].n).toBe(0)
})

it('a failing card write leaves the accept at 200 and the booking created', async () => {
  const r = await newRequest()
  const q = QuoteSchema.parse(await (await call(quotes.POST, U.owner, 'POST', { amount: 20, scope: 'Fence' }, { id: r.id })).json())
  await pool.query("CREATE OR REPLACE FUNCTION ch_no_cards() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'cards are down'; END $$")
  await pool.query("CREATE TRIGGER ch_no_cards BEFORE INSERT ON messages FOR EACH ROW WHEN (NEW.kind = 'card') EXECUTE FUNCTION ch_no_cards()")
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const res = await call(accept.POST, U.cust, 'POST', { startAt: day(15), durationMin: 60, onSite: true, address: { postcode: '10115' } }, { id: q.id })
    expect(res.status).toBe(200)
    expect((await pool.query('SELECT count(*)::int AS n FROM bookings WHERE quote_id = $1', [q.id])).rows[0].n).toBe(1)
    expect(log.mock.calls.some((c) => String(c[0]).includes('could not post a acceptance card'))).toBe(true)
  } finally {
    log.mockRestore()
    await pool.query('DROP TRIGGER ch_no_cards ON messages')
    await pool.query('DROP FUNCTION ch_no_cards()')
  }
})

it('a cursor that is not a real time or id is 400', async () => {
  const t = await threadOf(U.cust, (await newRequest()).id)
  expect((await list(t.id, U.cust, `2026-13-45T99:99:99Z|${crypto.randomUUID()}`)).status).toBe(400)
  expect((await list(t.id, U.cust, '2026-01-01T10:00:00Z|zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz')).status).toBe(400)
})
