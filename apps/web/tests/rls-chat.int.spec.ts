import { afterAll, beforeAll, expect, it } from 'vitest'
import { asUser, pool } from '@kando/db'
import { sql } from 'drizzle-orm'
import { cleanupUsers, seedProvider, seedUser } from './helpers'

const ids = { customer: 'rc-cust', owner: 'rc-owner', other: 'rc-other', owner2: 'rc-owner2' }
let providerId: string
let otherProviderId: string
let requestId: string
let otherRequestId: string
let threadId: string

beforeAll(async () => {
  await cleanupUsers()
  for (const id of [ids.customer, ids.other]) await seedUser(id)
  const categoryId = (await pool.query('SELECT id FROM categories LIMIT 1')).rows[0]?.id ?? (await pool.query("INSERT INTO categories (slug) VALUES ('rc-cat') RETURNING id")).rows[0].id
  providerId = await seedProvider(ids.owner, { name: 'Rc Owner', categoryId })
  otherProviderId = await seedProvider(ids.owner2, { name: 'Rc Two', categoryId })
  const req = (customer: string, provider: string) =>
    pool.query("INSERT INTO requests (customer_id, provider_id, description, answer_by) VALUES ($1, $2, 'x', now() + interval '7 days') RETURNING id", [customer, provider])
  requestId = (await req(ids.customer, providerId)).rows[0].id
  otherRequestId = (await req(ids.other, otherProviderId)).rows[0].id
  threadId = (await pool.query('INSERT INTO threads (request_id, customer_id, provider_id) VALUES ($1, $2, $3) RETURNING id', [requestId, ids.customer, providerId])).rows[0].id
  await pool.query("INSERT INTO messages (thread_id, sender_id, kind, body) VALUES ($1, $2, 'text', 'Hallo')", [threadId, ids.customer])
})

afterAll(cleanupUsers)

const rls = { cause: { message: expect.stringContaining('row-level security') } }
const denied = { cause: { message: expect.stringContaining('permission denied') } }
const run = (uid: string | null, q: ReturnType<typeof sql>) => asUser(uid, (tx) => tx.execute(q))
const insertMessage = (sender: string, thread = threadId) => sql`INSERT INTO messages (thread_id, sender_id, kind, body) VALUES (${thread}, ${sender}, 'text', 'hi')`

it('both parties read the thread and its messages; a third user reads none', async () => {
  const count = (uid: string | null) =>
    asUser(uid, async (tx) => [(await tx.execute(sql`SELECT id FROM threads`)).rows.length, (await tx.execute(sql`SELECT id FROM messages`)).rows.length])
  expect(await count(ids.customer)).toEqual([1, 1])
  expect(await count(ids.owner)).toEqual([1, 1])
  expect(await count(ids.other)).toEqual([0, 0])
  expect(await count(null)).toEqual([0, 0])
})

it('app_user cannot update or delete a message, even their own', async () => {
  for (const uid of [ids.customer, ids.owner]) {
    await expect(run(uid, sql`UPDATE messages SET body = 'edited'`)).rejects.toMatchObject(denied)
    await expect(run(uid, sql`DELETE FROM messages`)).rejects.toMatchObject(denied)
    await expect(run(uid, sql`UPDATE threads SET customer_id = ${ids.other}`)).rejects.toMatchObject(denied)
    await expect(run(uid, sql`DELETE FROM threads`)).rejects.toMatchObject(denied)
  }
})

it('a party can send a message; a third user and a forged sender are refused', async () => {
  await expect(run(ids.customer, insertMessage(ids.customer))).resolves.toBeTruthy()
  await expect(run(ids.owner, insertMessage(ids.owner))).resolves.toBeTruthy()
  await expect(run(ids.other, insertMessage(ids.other))).rejects.toMatchObject(rls)
})

it('a party cannot insert a message as the other party', async () => {
  await expect(run(ids.owner, insertMessage(ids.customer))).rejects.toMatchObject(rls)
  await expect(run(ids.customer, insertMessage(ids.owner))).rejects.toMatchObject(rls)
})

it('threads: only a party can open one, for their own request, with the right parties', async () => {
  const open = (uid: string, customer: string, provider: string, request: string) =>
    run(uid, sql`INSERT INTO threads (request_id, customer_id, provider_id) VALUES (${request}, ${customer}, ${provider})`)
  await expect(open(ids.other, ids.other, providerId, requestId)).rejects.toMatchObject(rls) // not the request's customer
  await expect(open(ids.owner2, ids.customer, otherProviderId, requestId)).rejects.toMatchObject(rls) // forged request of someone else
  await expect(open(ids.other, ids.other, otherProviderId, otherRequestId)).resolves.toBeTruthy()
  await pool.query('DELETE FROM threads WHERE request_id = $1', [otherRequestId])
})

it("a blocked party's raw insert is refused by RLS", async () => {
  await pool.query('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)', [ids.owner, ids.customer])
  await expect(run(ids.customer, insertMessage(ids.customer))).rejects.toMatchObject(rls) // the blocked one
  await expect(run(ids.owner, insertMessage(ids.owner))).rejects.toMatchObject(rls) // the blocker too: it works both ways
  await pool.query('DELETE FROM blocks')
  await expect(run(ids.customer, insertMessage(ids.customer))).resolves.toBeTruthy()
})

it('blocks are visible only to the blocker', async () => {
  await run(ids.owner, sql`INSERT INTO blocks (blocker_id, blocked_id) VALUES (${ids.owner}, ${ids.customer})`)
  await expect(run(ids.owner, sql`INSERT INTO blocks (blocker_id, blocked_id) VALUES (${ids.customer}, ${ids.owner})`)).rejects.toMatchObject(rls)
  const seen = (uid: string) => asUser(uid, async (tx) => (await tx.execute(sql`SELECT blocker_id FROM blocks`)).rows.length)
  expect(await seen(ids.owner)).toBe(1)
  expect(await seen(ids.customer)).toBe(0)
  expect(await seen(ids.other)).toBe(0)
  await pool.query('DELETE FROM blocks')
})

it('app_user cannot read staff_flags or contact_attempts', async () => {
  for (const t of ['staff_flags', 'contact_attempts']) await expect(run(ids.owner, sql.raw(`SELECT * FROM ${t}`))).rejects.toMatchObject(denied)
})

it('the block also holds when the provider profile is hidden from the customer (draft)', async () => {
  await pool.query("UPDATE providers SET status = 'draft' WHERE id = $1", [providerId])
  await pool.query('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)', [ids.owner, ids.customer])
  await expect(run(ids.customer, insertMessage(ids.customer))).rejects.toMatchObject(rls)
  await pool.query('DELETE FROM blocks')
  await pool.query("UPDATE providers SET status = 'published' WHERE id = $1", [providerId])
})

it('is_blocked answers only for a caller who is one of the two; a third user probing gets false', async () => {
  await pool.query('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)', [ids.owner, ids.customer])
  const probe = (uid: string | null, q: ReturnType<typeof sql>) => asUser(uid, async (tx) => (await tx.execute(q)).rows[0]!.b)
  const byUser = sql`SELECT is_blocked(${ids.owner}, ${ids.customer}) AS b`
  const byProvider = sql`SELECT is_blocked(${ids.customer}, ${providerId}::uuid) AS b`
  expect(await probe(ids.customer, byUser)).toBe(true)
  expect(await probe(ids.owner, byUser)).toBe(true)
  expect(await probe(ids.other, byUser)).toBe(false)
  expect(await probe(null, byUser)).toBe(false)
  expect(await probe(ids.customer, byProvider)).toBe(true)
  expect(await probe(ids.owner, byProvider)).toBe(true)
  expect(await probe(ids.other, byProvider)).toBe(false)
  await pool.query('DELETE FROM blocks')
})

it('app_user cannot insert a card message (cards are written by the domain on the owner connection)', async () => {
  await expect(
    run(ids.owner, sql`INSERT INTO messages (thread_id, sender_id, kind, card) VALUES (${threadId}, ${ids.owner}, 'card', '{"type":"acceptance","refId":"x"}'::jsonb)`),
  ).rejects.toMatchObject(rls)
  await expect(run(ids.owner, sql`INSERT INTO messages (thread_id, sender_id, kind, photo_key) VALUES (${threadId}, ${ids.owner}, 'photo', 'chat/x.jpg')`)).resolves.toBeTruthy()
})

it('messages hold the content of their kind only', async () => {
  const raw = (kind: string, body: string | null, key: string | null, card: string | null) =>
    pool.query('INSERT INTO messages (thread_id, sender_id, kind, body, photo_key, card) VALUES ($1, $2, $3, $4, $5, $6::jsonb)', [threadId, ids.customer, kind, body, key, card])
  await expect(raw('text', '', null, null)).rejects.toThrow() // empty body
  await expect(raw('text', 'x', 'k', null)).rejects.toThrow() // text with a photo key
  await expect(raw('photo', 'x', 'k', null)).rejects.toThrow() // photo with a body
  await expect(raw('card', null, 'k', '{"type":"quote","refId":"r"}')).rejects.toThrow() // card with a photo key
  await expect(raw('card', null, null, '{"type":"quote","refId":"r"}')).resolves.toBeTruthy()
})

it('threads: a booking thread passes the policy, a forged booking does not; exactly one parent; one thread per request', async () => {
  const bookingOf = async (customer: string, provider: string) =>
    (await pool.query("INSERT INTO bookings (customer_id, provider_id, source, status, start_at, duration_min, amount, currency, on_site) VALUES ($1, $2, 'direct', 'proposed', now() + interval '3 days', 60, 50, 'EUR', false) RETURNING id", [customer, provider])).rows[0].id
  const mine = await bookingOf(ids.customer, providerId)
  const theirs = await bookingOf(ids.other, otherProviderId)
  const open = (uid: string, booking: string) => run(uid, sql`INSERT INTO threads (booking_id, customer_id, provider_id) VALUES (${booking}, ${ids.customer}, ${providerId})`)
  await expect(open(ids.customer, theirs)).rejects.toMatchObject(rls) // someone else's booking
  await expect(open(ids.customer, mine)).resolves.toBeTruthy()
  const both = (await pool.query('SELECT $1::uuid AS r', [requestId])).rows[0].r
  await expect(pool.query('INSERT INTO threads (customer_id, provider_id) VALUES ($1, $2)', [ids.customer, providerId])).rejects.toThrow() // no parent
  await expect(pool.query('INSERT INTO threads (request_id, booking_id, customer_id, provider_id) VALUES ($1, $2, $3, $4)', [both, mine, ids.customer, providerId])).rejects.toThrow() // two parents
  await expect(run(ids.customer, sql`INSERT INTO threads (request_id, customer_id, provider_id) VALUES (${requestId}, ${ids.customer}, ${providerId})`)).rejects.toThrow() // second thread for the request
})

it('app_user cannot insert into staff_flags or contact_attempts either', async () => {
  await expect(run(ids.owner, sql`INSERT INTO staff_flags (kind, ref_id) VALUES ('message-reported', 'x')`)).rejects.toMatchObject(denied)
  await expect(run(ids.owner, sql`INSERT INTO contact_attempts (user_id, hit, text) VALUES (${ids.owner}, 'phone', 'x')`)).rejects.toMatchObject(denied)
})

it('one open staff flag per kind, ref and user, also when the user is NULL', async () => {
  const flag = (user: string | null) => pool.query("INSERT INTO staff_flags (kind, ref_id, user_id) VALUES ('message-reported', 'dup', $1)", [user])
  await flag(null)
  await expect(flag(null)).rejects.toThrow()
  await pool.query("DELETE FROM staff_flags WHERE ref_id = 'dup'")
})
