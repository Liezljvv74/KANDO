import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { pool } from '@kando/db'
import { setStorageForTests } from '@kando/domain'
import { call, cleanupUsers, EMAIL, memoryStorage, seedBase, seedProvider, seedUser } from './helpers'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const exportRoute = await import('../app/app-api/v1/me/export/route')

const U = { cust: 'eb-cust', owner: 'eb-owner', other: 'eb-other', blocked: 'eb-blocked' }
const ADDRESS = 'Geheimstrasse 99'
let reqId: string, bookingId: string, threadId: string

beforeAll(async () => {
  setStorageForTests(memoryStorage())
  await cleanupUsers()
  const { categoryId } = await seedBase()
  await seedUser(U.cust, null, 'Cora Kunde')
  await seedUser(U.other, null, 'Olaf Fremd')
  await seedUser(U.blocked, null, 'Bernd Blockiert')
  const p = await seedProvider(U.owner, { name: 'Eb Owner', categoryId })
  const q = (sql: string, v: unknown[]) => pool.query(sql, v)
  reqId = (await q("INSERT INTO requests (customer_id, provider_id, description, answer_by, status) VALUES ($1, $2, 'Zaun reparieren', now() + interval '3 days', 'booked') RETURNING id", [U.cust, p])).rows[0].id
  // somebody else's request to the same provider: never in cust's export
  await q("INSERT INTO requests (customer_id, provider_id, description, answer_by) VALUES ($1, $2, 'Fremder Auftrag', now() + interval '3 days')", [U.other, p])
  const quote = (await q("INSERT INTO quotes (request_id, provider_id, amount, scope, expires_at, status) VALUES ($1, $2, 120, 'Zaun komplett', now() + interval '7 days', 'accepted') RETURNING id", [reqId, p])).rows[0].id
  bookingId = (
    await q(
      `INSERT INTO bookings (customer_id, provider_id, quote_id, source, status, start_at, duration_min, amount, on_site, address_street, address_postcode, address_city, note, pay_by)
       VALUES ($1, $2, $3, 'quote', 'awaiting-payment', now() + interval '10 days', 120, 120, true, $4, '10115', 'Berlin', 'Tor ist blau', now() + interval '2 days') RETURNING id`,
      [U.cust, p, quote, ADDRESS],
    )
  ).rows[0].id
  threadId = (await q('INSERT INTO threads (request_id, customer_id, provider_id) VALUES ($1, $2, $3) RETURNING id', [reqId, U.cust, p])).rows[0].id
  await q("INSERT INTO messages (thread_id, sender_id, kind, body) VALUES ($1, $2, 'text', 'Meine Nachricht')", [threadId, U.cust])
  await q("INSERT INTO messages (thread_id, sender_id, kind, photo_key) VALUES ($1, $2, 'photo', 'chat/t1/zaun.jpg')", [threadId, U.cust])
  await q("INSERT INTO messages (thread_id, sender_id, kind, body) VALUES ($1, $2, 'text', 'Antwort des Anbieters')", [threadId, U.owner])
  await q('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)', [U.cust, U.blocked])
  await q("INSERT INTO staff_flags (kind, ref_id, user_id, note) VALUES ('contact-attempts', $1, $2, 'Staffnotiz geheim')", [threadId, U.cust])
  await q("INSERT INTO contact_attempts (user_id, thread_id, hit, text) VALUES ($1, $2, 'phone', 'Rufnummer-Versuch')", [U.cust, threadId])
  await q("INSERT INTO staff_access_log (staff_id, thread_id, outcome) VALUES ('someone', $1, 'allowed')", [threadId])
})
afterAll(async () => {
  setStorageForTests(undefined)
  await cleanupUsers()
})

const csv = async (uid: string) => Buffer.from(await (await exportRoute.GET(new Request('http://localhost/app-api/v1/me/export?format=csv', { headers: { cookie: `uid=${uid}:${EMAIL(uid)}` } }), { params: Promise.resolve({}) })).arrayBuffer()).toString('utf8')

it('the export contains my requests, quotes, bookings and my sent messages and nothing of other people\'s', async () => {
  const body = await (await call(exportRoute.GET, U.cust)).json()
  expect(body.requests).toHaveLength(1)
  expect(body.requests[0]).toMatchObject({ id: reqId, role: 'customer', description: 'Zaun reparieren', status: 'booked' })
  expect(body.quotes).toHaveLength(1)
  expect(body.quotes[0]).toMatchObject({ requestId: reqId, amount: 120, scope: 'Zaun komplett', status: 'accepted' })
  expect(body.bookings).toHaveLength(1)
  expect(body.bookings[0]).toMatchObject({ id: bookingId, role: 'customer', status: 'awaiting-payment', note: 'Tor ist blau', address: { street: ADDRESS, postcode: '10115', city: 'Berlin' } })
  expect(body.messages.map((m: { body: string | null; photo: string | null }) => m.body ?? m.photo).sort()).toEqual(['Meine Nachricht', 'zaun.jpg'])
  expect(body.messages[0]).toMatchObject({ threadId, requestId: reqId, bookingId: null, createdAt: expect.any(String) })
  expect(body.blocks).toEqual([{ name: expect.stringContaining('Bernd') }])
  const text = JSON.stringify(body) + (await csv(U.cust))
  for (const secret of ['Fremder Auftrag', 'Antwort des Anbieters', EMAIL(U.owner), EMAIL(U.other), U.other, U.owner, 'chat/t1']) expect(text).not.toContain(secret)
  expect(await csv(U.cust)).toContain('Meine Nachricht')
  const provider = await (await call(exportRoute.GET, U.owner)).json()
  expect(provider.messages.map((m: { body: string }) => m.body)).toEqual(['Antwort des Anbieters'])
  expect(provider.requests.map((r: { description: string }) => r.description).sort()).toEqual(['Fremder Auftrag', 'Zaun reparieren'])
  expect(provider.requests.every((r: { role: string }) => r.role === 'provider')).toBe(true)
  expect(JSON.stringify(provider)).not.toContain(U.cust) // the customer's id is not in a provider's export
})

it('a provider\'s export does not contain the customer\'s address', async () => {
  const body = await (await call(exportRoute.GET, U.owner)).json()
  expect(body.bookings).toHaveLength(1)
  expect(body.bookings[0]).toMatchObject({ id: bookingId, role: 'provider', address: null })
  for (const text of [JSON.stringify(body), await csv(U.owner)]) {
    expect(text).not.toContain(ADDRESS)
    expect(text).not.toContain('Berlin"') // city of the job address
  }
})

it('the export has no staff-only data', async () => {
  for (const uid of [U.cust, U.owner]) {
    const text = JSON.stringify(await (await call(exportRoute.GET, uid)).json()) + (await csv(uid))
    for (const s of ['Staffnotiz geheim', 'Rufnummer-Versuch', 'contact-attempts', 'someone', 'staff_access_log', 'allowed']) expect(text).not.toContain(s)
  }
})
