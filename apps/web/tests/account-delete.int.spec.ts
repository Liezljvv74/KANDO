import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { pool } from '@kando/db'
import { ACCOUNT_TABLES, clearOutbox, outboxForTests, setStorageForTests } from '@kando/domain'
import { adminCall, call, cleanupUsers, EMAIL, memoryStorage, seedBase, seedUser } from './helpers'

vi.mock('../lib/auth/server', async () => ({ ...(await (await import('./helpers')).mockAuth()), sessionFromRequest: (await import('./helpers')).fakeSession }))
const me = await import('../app/app-api/v1/me/route')
const staffRoute = await import('../app/api/admin/[resource]/route')
const cron = await import('../app/api/cron/suspensions/route')

const store = memoryStorage()
let categoryId: string
let createdNeonAuth = false

beforeAll(async () => {
  setStorageForTests(store)
  ;({ categoryId } = await seedBase())
  // Stand-in for the Neon Auth tables (the real ones only exist on the Neon branch): foreign keys to the user without
  // cascade, so the test proves the delete finds each referencing table and removes its rows itself.
  createdNeonAuth = !(await pool.query("SELECT to_regnamespace('neon_auth') AS s")).rows[0].s
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS neon_auth;
    CREATE TABLE IF NOT EXISTS neon_auth."user" (id text PRIMARY KEY, email text, "emailVerified" boolean);
    DROP TABLE IF EXISTS neon_auth.account, neon_auth.session, neon_auth.member, neon_auth.invitation;
    CREATE TABLE neon_auth.account (id serial PRIMARY KEY, "userId" text NOT NULL REFERENCES neon_auth."user"(id));
    CREATE TABLE neon_auth.session (id serial PRIMARY KEY, "userId" text NOT NULL REFERENCES neon_auth."user"(id));
    CREATE TABLE neon_auth.member (id serial PRIMARY KEY, "userId" text NOT NULL REFERENCES neon_auth."user"(id));
    CREATE TABLE neon_auth.invitation (id serial PRIMARY KEY, "inviterId" text NOT NULL REFERENCES neon_auth."user"(id));
    CREATE TABLE IF NOT EXISTS neon_auth.verification (id serial PRIMARY KEY, identifier text NOT NULL);`)
  await pool.query("UPDATE users SET staff_role = NULL WHERE staff_role = 'admin'") // no admin left over from another spec file
})
beforeEach(() => {
  vi.stubEnv('RESEND_API_KEY', '')
  vi.stubEnv('CRON_SECRET', 's3cret')
  vi.stubEnv('DELETE_RETENTION_MONTHS', '0') // these tests are about the immediate delete; retention is in account-retention.int.spec.ts
  clearOutbox()
  store.objects.clear()
})
afterEach(() => vi.unstubAllEnvs())
afterAll(async () => {
  setStorageForTests(undefined)
  await pool.query("DELETE FROM translation_requests WHERE client_key LIKE 'user:ad%'")
  await pool.query('DELETE FROM pending_object_deletes')
  await cleanupUsers()
  for (const t of ['account', 'session', 'member', 'invitation', 'verification', 'user']) await pool.query(`DELETE FROM neon_auth."${t}"`)
  if (createdNeonAuth) await pool.query('DROP SCHEMA neon_auth CASCADE')
})

const del = (uid: string, password = 'right-password', headers?: Record<string, string>) =>
  me.DELETE(
    new Request('http://localhost/app-api/v1/me', {
      method: 'DELETE',
      headers: headers ?? { origin: 'http://localhost', cookie: `uid=${uid}:${EMAIL(uid)}`, 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    }),
    { params: Promise.resolve({}) },
  )
const runCron = () => cron.GET(new Request('http://localhost/api/cron/suspensions', { headers: { authorization: 'Bearer s3cret' } }))

const count = async (sql: string, params: unknown[] = []) => Number((await pool.query(sql, params)).rows[0].n)
const authUser = (uid: string) => pool.query('INSERT INTO neon_auth."user" (id, email, "emailVerified") VALUES ($1, $2, true) ON CONFLICT DO NOTHING', [uid, EMAIL(uid)])
/** A person as the app sees one after sign-up: in Neon Auth and in users. */
const person = async (uid: string, staffRole: string | null = null) => {
  await authUser(uid)
  await seedUser(uid, staffRole)
}

/** The identifiers Better Auth's email-OTP plugin stores for one address. */
const otpIdentifiers = (email: string) => [email.toUpperCase(), `email-verification-otp-${email}`, `forget-password-otp-${email}`, `sign-in-otp-${email}`]
/** Codes that only look similar (another address ending the same way); they belong to other people and must stay. */
const lookalikes = (email: string) => [`email-verification-otp-a${email}`, `email-verification-otp-x-otp-${email}`, `${email}.other`]

/** A person with every kind of data, objects in both buckets and Neon Auth records. */
async function fullPerson(uid: string, lang = 'en') {
  await person(uid)
  await pool.query("UPDATE users SET language = $2, first_name = 'Ada', last_name = 'Lovelace' WHERE id = $1", [uid, lang])
  const p = (
    await pool.query(
      `INSERT INTO providers (owner_id, type, public_name, slug, base_postcode, location, status)
       VALUES ($1, 'private', 'Ada L.', $2, '10115', (SELECT location FROM postcodes WHERE code = '10115'), 'published') RETURNING id`,
      [uid, `${uid}-slug`],
    )
  ).rows[0].id
  await pool.query("INSERT INTO services (provider_id, category_id, title, price_type) VALUES ($1, $2, 'Garden', 'on-request')", [p, categoryId])
  await pool.query("INSERT INTO provider_references (provider_id, client_name, description) VALUES ($1, 'Mrs Client', 'Hedge')", [p])
  const keys = { profile: `people/${uid}/p.jpg`, portfolio: `providers/${p}/a.jpg`, file: `documents/${uid}/f.pdf`, doc: `documents/${uid}/d.pdf` }
  const objects = [`media/${keys.profile}`, `media/${keys.portfolio}`, `documents/${keys.file}`, `documents/${keys.doc}`]
  for (const k of objects) store.objects.set(k, Buffer.from('x'))
  await pool.query("INSERT INTO photos (owner_id, kind, key, width, height) VALUES ($1, 'profile', $2, 1, 1)", [uid, keys.profile])
  await pool.query("INSERT INTO photos (owner_id, provider_id, kind, key, width, height) VALUES ($1, $2, 'portfolio', $3, 1, 1)", [uid, p, keys.portfolio])
  await pool.query('INSERT INTO private_files (owner_id, key) VALUES ($1, $2)', [uid, keys.file])
  await pool.query("INSERT INTO documents (owner_id, requirement, key) VALUES ($1, 'permit', $2)", [uid, keys.doc])
  await pool.query("INSERT INTO notifications (user_id, kind, payload) VALUES ($1, 'profile-live', '{}')", [uid])
  await pool.query('INSERT INTO translation_requests (client_key) VALUES ($1)', [`user:${uid}`])
  for (const t of ['account', 'session', 'member']) await pool.query(`INSERT INTO neon_auth.${t} ("userId") VALUES ($1)`, [uid])
  await pool.query('INSERT INTO neon_auth.invitation ("inviterId") VALUES ($1)', [uid])
  for (const id of [...otpIdentifiers(EMAIL(uid)), ...lookalikes(EMAIL(uid))]) await pool.query('INSERT INTO neon_auth.verification (identifier) VALUES ($1)', [id])
  return { providerId: p, objects }
}

/** Row counts of every table that can hold something of the person. */
async function rowsOf(uid: string, providerId: string) {
  return {
    users: await count('SELECT count(*) n FROM users WHERE id = $1', [uid]),
    providers: await count('SELECT count(*) n FROM providers WHERE owner_id = $1', [uid]),
    services: await count('SELECT count(*) n FROM services WHERE provider_id = $1', [providerId]),
    references: await count('SELECT count(*) n FROM provider_references WHERE provider_id = $1', [providerId]),
    photos: await count('SELECT count(*) n FROM photos WHERE owner_id = $1', [uid]),
    files: await count('SELECT count(*) n FROM private_files WHERE owner_id = $1', [uid]),
    documents: await count('SELECT count(*) n FROM documents WHERE owner_id = $1', [uid]),
    notifications: await count('SELECT count(*) n FROM notifications WHERE user_id = $1', [uid]),
    requests: await count('SELECT count(*) n FROM translation_requests WHERE client_key = $1', [`user:${uid}`]),
    authUser: await count('SELECT count(*) n FROM neon_auth."user" WHERE id = $1', [uid]),
    authAccount: await count('SELECT count(*) n FROM neon_auth.account WHERE "userId" = $1', [uid]),
    authSession: await count('SELECT count(*) n FROM neon_auth.session WHERE "userId" = $1', [uid]),
    authMember: await count('SELECT count(*) n FROM neon_auth.member WHERE "userId" = $1', [uid]),
    authInvitation: await count('SELECT count(*) n FROM neon_auth.invitation WHERE "inviterId" = $1', [uid]),
    authVerification: await count('SELECT count(*) n FROM neon_auth.verification WHERE identifier = ANY($1)', [otpIdentifiers(EMAIL(uid))]),
  }
}
const lookalikeRows = (uid: string) => count('SELECT count(*) n FROM neon_auth.verification WHERE identifier = ANY($1)', [lookalikes(EMAIL(uid))])

it('deletes every row, object and Neon Auth record of the person, keeps the other person, mails once in their language', async () => {
  const a = await fullPerson('ad1', 'de')
  const b = await fullPerson('ad2', 'en')
  const before = await rowsOf('ad1', a.providerId)
  expect(Object.values(before).every((n) => n >= 1)).toBe(true) // the fixture really has every kind of data
  expect(before.authVerification).toBe(4) // the bare address and the three OTP types

  const res = await del('ad1')
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true })

  expect(Object.values(await rowsOf('ad1', a.providerId)).every((n) => n === 0)).toBe(true)
  expect(await lookalikeRows('ad1')).toBe(3) // codes of other addresses are not touched
  expect(await rowsOf('ad2', b.providerId)).toEqual(before) // the other person is untouched
  expect(await count('SELECT count(*) n FROM pending_object_deletes')).toBe(0) // all objects are gone, no owed delete is left

  expect([...store.objects.keys()].sort()).toEqual([...b.objects].sort())
  const mails = outboxForTests()
  expect(mails).toHaveLength(1)
  expect(mails[0]).toMatchObject({ to: EMAIL('ad1'), subject: 'Dein Konto wurde gelöscht' })
  expect(mails[0]!.text).not.toContain('skilled://')
})

it('the delete function knows every table that points at users or providers', async () => {
  const { rows } = await pool.query(
    `SELECT DISTINCT c.conrelid::regclass::text AS tbl FROM pg_constraint c
     WHERE c.contype = 'f' AND c.confrelid IN ('public.users'::regclass, 'public.providers'::regclass)`,
  )
  expect(rows.map((r) => r.tbl).sort()).toEqual([...ACCOUNT_TABLES].sort())
})

it('pending_object_deletes is closed to the app role', async () => {
  const { rows } = await pool.query("SELECT has_table_privilege('app_user', 'pending_object_deletes', 'SELECT') OR has_table_privilege('app_user', 'pending_object_deletes', 'INSERT') OR has_table_privilege('app_user', 'pending_object_deletes', 'DELETE') AS any_right")
  expect(rows[0].any_right).toBe(false)
})

it('a wrong password is 403 WRONG_PASSWORD, deletes nothing and sets no cookie', async () => {
  const a = await fullPerson('ad3')
  const res = await del('ad3', 'wrong-password')
  expect(res.status).toBe(403)
  expect(await res.json()).toEqual({ error: 'WRONG_PASSWORD' })
  expect(res.headers.get('set-cookie')).toBeNull()
  expect((await rowsOf('ad3', a.providerId)).users).toBe(1)
  expect(store.objects.size).toBe(4)
  expect(outboxForTests()).toHaveLength(0)
  expect(await count('SELECT count(*) n FROM invoices WHERE customer_id = $1 OR provider_id = $2', ['ad3', a.providerId])).toBe(0)
  expect(await count('SELECT count(*) n FROM commission_invoices WHERE provider_id = $1', [a.providerId])).toBe(0)
})

it('auth busy is 503 AUTH_BUSY and deletes nothing', async () => {
  const a = await fullPerson('ad3b')
  const res = await del('ad3b', 'busy')
  expect(res.status).toBe(503)
  expect(await res.json()).toEqual({ error: 'AUTH_BUSY' })
  expect(res.headers.get('set-cookie')).toBeNull()
  expect((await rowsOf('ad3b', a.providerId)).users).toBe(1)
  expect(outboxForTests()).toHaveLength(0)
})

it('a body without password is 400', async () => {
  await person('ad4')
  expect((await call(me.DELETE, 'ad4', 'DELETE', {})).status).toBe(400)
  expect((await call(me.DELETE, 'ad4', 'DELETE', { password: '' })).status).toBe(400)
  expect(await count("SELECT count(*) n FROM users WHERE id = 'ad4'")).toBe(1)
})

it('the only Administrator cannot delete the account (409 LAST_ADMIN); with a second one it can', async () => {
  await person('ad5', 'admin')
  const res = await del('ad5')
  expect(res.status).toBe(409)
  expect(await res.json()).toEqual({ error: 'LAST_ADMIN' })
  expect(await count("SELECT count(*) n FROM users WHERE id = 'ad5'")).toBe(1)
  await person('ad6', 'admin')
  expect((await del('ad5')).status).toBe(200)
  expect(await count("SELECT count(*) n FROM users WHERE id = 'ad5'")).toBe(0)
  expect((await del('ad6')).status).toBe(409) // now ad6 is the last one
})

it('signed out is 401, an unconfirmed email is 403', async () => {
  await person('ad7')
  expect((await del('ad7', 'right-password', { 'content-type': 'application/json' })).status).toBe(401)
  const unverified = await del('ad7', 'right-password', { origin: 'http://localhost', cookie: `uid=ad7:${EMAIL('ad7')}; verified=0`, 'content-type': 'application/json' })
  expect(unverified.status).toBe(403)
  expect(await count("SELECT count(*) n FROM users WHERE id = 'ad7'")).toBe(1)
})

it('storage failing leaves owed deletes, logs only count and error name, answers 200; the daily job removes the objects and rows', async () => {
  const a = await fullPerson('ad8')
  setStorageForTests({
    ...store,
    delete: async () => {
      throw new TypeError('secret-key-in-message')
    },
  })
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  const res = await del('ad8')
  expect(res.status).toBe(200)
  expect((await rowsOf('ad8', a.providerId)).users).toBe(0)
  expect(await count('SELECT count(*) n FROM pending_object_deletes')).toBe(4)
  // The daily job with storage still down: 200, the rows wait for tomorrow.
  expect((await runCron()).status).toBe(200)
  expect(await count('SELECT count(*) n FROM pending_object_deletes')).toBe(4)
  const lines = log.mock.calls.map((c) => c.join(' ')).join('\n')
  log.mockRestore()
  expect(lines).toContain('4 of 4 objects could not be removed')
  expect(lines).toContain('TypeError')
  expect(lines).not.toContain('ad8')
  expect(lines).not.toContain('secret-key')
  // Storage is back: the next run removes the objects and the rows.
  setStorageForTests(store)
  expect(await (await runCron()).json()).toMatchObject({ pendingObjects: 0 })
  expect(await count('SELECT count(*) n FROM pending_object_deletes')).toBe(0)
  expect(a.objects.filter((k) => store.objects.has(k))).toEqual([])
})

it('deleting twice: the second call is 401, nothing is recreated, no second email; /me with the old session is 401 too', async () => {
  await fullPerson('ad9')
  expect((await del('ad9')).status).toBe(200)
  expect(outboxForTests()).toHaveLength(1)
  // The old session cookie still looks valid to the app, but Neon Auth no longer knows the account.
  expect((await del('ad9')).status).toBe(401)
  expect((await call(me.GET, 'ad9')).status).toBe(401)
  expect(await count('SELECT count(*) n FROM users WHERE id = $1 OR email = $2', ['ad9', EMAIL('ad9')])).toBe(0)
  expect(outboxForTests()).toHaveLength(1)
})

it('a staff reviewer who deletes their account is removed from the documents they reviewed', async () => {
  const a = await fullPerson('ad10')
  await person('ad11', 'reviewer')
  await pool.query("UPDATE documents SET status = 'approved', reviewed_by = 'ad11', reviewed_at = now() WHERE owner_id = 'ad10'")
  expect((await del('ad11')).status).toBe(200)
  const doc = (await pool.query("SELECT status, reviewed_by FROM documents WHERE owner_id = 'ad10'")).rows[0]
  expect(doc).toEqual({ status: 'approved', reviewed_by: null })
  expect((await rowsOf('ad10', a.providerId)).documents).toBe(1)
})

it('two staff operations at once (delete-self, demote) never deadlock and leave an Administrator', async () => {
  for (let round = 0; round < 4; round++) {
    const [a, b, c] = [`ad2${round}a`, `ad2${round}b`, `ad2${round}c`]
    for (const id of [a, b, c]) await person(id, 'admin')
    const demote = (id: string) => adminCall(staffRoute.PATCH, c, 'PATCH', '/x', { email: EMAIL(id), staffRole: null }, { resource: 'staff' })
    const results = await Promise.all([del(a), demote(b), demote(a), del(b)])
    for (const r of results) expect([200, 404, 409]).toContain(r.status) // never a 500 from a deadlock
    expect(await count("SELECT count(*) n FROM users WHERE staff_role = 'admin'")).toBeGreaterThanOrEqual(1)
    for (const id of [a, b, c]) await pool.query('UPDATE users SET staff_role = NULL WHERE id = $1', [id])
  }
})

it('chat photos of the deleted person\'s threads are owed and removed from the private bucket', async () => {
  const a = await fullPerson('ad9')
  await person('ad9c')
  const req = (await pool.query("INSERT INTO requests (customer_id, provider_id, description, answer_by) VALUES ('ad9c', $1, 'x', now() + interval '3 days') RETURNING id", [a.providerId])).rows[0].id
  const thread = (await pool.query("INSERT INTO threads (request_id, customer_id, provider_id) VALUES ($1, 'ad9c', $2) RETURNING id", [req, a.providerId])).rows[0].id
  const key = `chat/${thread}/p.jpg`
  store.objects.set(`documents/${key}`, Buffer.from('x'))
  await pool.query("INSERT INTO messages (thread_id, sender_id, kind, photo_key) VALUES ($1, 'ad9c', 'photo', $2)", [thread, key])
  setStorageForTests({ ...store, delete: async () => { throw new Error('down') } })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  expect((await del('ad9')).status).toBe(200)
  expect((await pool.query("SELECT count(*)::int AS n FROM pending_object_deletes WHERE bucket = 'documents' AND key = $1", [key])).rows[0].n).toBe(1) // owed, so the retry job removes it
  vi.restoreAllMocks()
  setStorageForTests(store)
  await runCron()
  expect(store.objects.has(`documents/${key}`)).toBe(false)
})
