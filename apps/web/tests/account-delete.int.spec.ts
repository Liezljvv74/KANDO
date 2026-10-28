import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { pool } from '@kando/db'
import { ACCOUNT_TABLES, clearOutbox, outboxForTests, setStorageForTests } from '@kando/domain'
import { call, cleanupUsers, EMAIL, memoryStorage, seedBase, seedUser } from './helpers'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const me = await import('../app/app-api/v1/me/route')

const store = memoryStorage()
let categoryId: string
let createdNeonAuth = false

beforeAll(async () => {
  setStorageForTests(store)
  ;({ categoryId } = await seedBase())
  // Stand-in for the Neon Auth tables (the real ones only exist on the Neon branch): deliberately without cascading
  // foreign keys, so the test proves the delete removes each table itself.
  createdNeonAuth = !(await pool.query("SELECT to_regnamespace('neon_auth') AS s")).rows[0].s
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS neon_auth;
    CREATE TABLE IF NOT EXISTS neon_auth."user" (id text PRIMARY KEY, email text, "emailVerified" boolean);
    CREATE TABLE IF NOT EXISTS neon_auth.account (id serial PRIMARY KEY, "userId" text NOT NULL);
    CREATE TABLE IF NOT EXISTS neon_auth.session (id serial PRIMARY KEY, "userId" text NOT NULL);
    CREATE TABLE IF NOT EXISTS neon_auth.member (id serial PRIMARY KEY, "userId" text NOT NULL);
    CREATE TABLE IF NOT EXISTS neon_auth.verification (id serial PRIMARY KEY, identifier text NOT NULL);`)
  await pool.query("UPDATE users SET staff_role = NULL WHERE staff_role = 'admin'") // no admin left over from another spec file
})
beforeEach(() => {
  vi.stubEnv('RESEND_API_KEY', '')
  clearOutbox()
  store.objects.clear()
})
afterEach(() => vi.unstubAllEnvs())
afterAll(async () => {
  setStorageForTests(undefined)
  await pool.query("DELETE FROM translation_requests WHERE client_key LIKE 'user:ad%'")
  await cleanupUsers()
  for (const t of ['user', 'account', 'session', 'member', 'verification']) await pool.query(`DELETE FROM neon_auth."${t}"`)
  if (createdNeonAuth) await pool.query('DROP SCHEMA neon_auth CASCADE')
})

const del = (uid: string, confirmEmail: string = EMAIL(uid), headers?: Record<string, string>) =>
  me.DELETE(
    new Request('http://localhost/app-api/v1/me', {
      method: 'DELETE',
      headers: headers ?? { cookie: `uid=${uid}:${EMAIL(uid)}`, 'content-type': 'application/json' },
      body: JSON.stringify({ confirmEmail }),
    }),
    { params: Promise.resolve({}) },
  )

const count = async (sql: string, params: unknown[] = []) => Number((await pool.query(sql, params)).rows[0].n)

/** A person with every kind of data, objects in both buckets and Neon Auth records. */
async function fullPerson(uid: string, lang = 'en') {
  await seedUser(uid)
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
  await pool.query('INSERT INTO neon_auth."user" (id, email, "emailVerified") VALUES ($1, $2, true)', [uid, EMAIL(uid)])
  for (const t of ['account', 'session', 'member']) await pool.query(`INSERT INTO neon_auth.${t} ("userId") VALUES ($1)`, [uid])
  await pool.query('INSERT INTO neon_auth.verification (identifier) VALUES ($1)', [EMAIL(uid).toUpperCase()])
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
    authVerification: await count('SELECT count(*) n FROM neon_auth.verification WHERE lower(identifier) = lower($1)', [EMAIL(uid)]),
  }
}

it('deletes every row, object and Neon Auth record of the person, keeps the other person, mails once in their language', async () => {
  const a = await fullPerson('ad1', 'de')
  const b = await fullPerson('ad2', 'en')
  const before = await rowsOf('ad1', a.providerId)
  expect(Object.values(before).every((n) => n >= 1)).toBe(true) // the fixture really has every kind of data

  const res = await del('ad1', `  ${EMAIL('ad1').toUpperCase()} `) // case and spaces do not matter
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true })

  expect(Object.values(await rowsOf('ad1', a.providerId)).every((n) => n === 0)).toBe(true)
  expect(await rowsOf('ad2', b.providerId)).toEqual(before) // the other person is untouched

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

it('a wrong email is 400 EMAIL_MISMATCH and deletes nothing', async () => {
  const a = await fullPerson('ad3')
  const res = await del('ad3', 'someone@else.invalid')
  expect(res.status).toBe(400)
  expect(await res.json()).toEqual({ error: 'EMAIL_MISMATCH' })
  expect((await rowsOf('ad3', a.providerId)).users).toBe(1)
  expect(store.objects.size).toBe(4)
  expect(outboxForTests()).toHaveLength(0)
})

it('a body without confirmEmail is 400', async () => {
  await seedUser('ad4')
  expect((await call(me.DELETE, 'ad4', 'DELETE', {})).status).toBe(400)
  expect(await count("SELECT count(*) n FROM users WHERE id = 'ad4'")).toBe(1)
})

it('the only Administrator cannot delete the account (409 LAST_ADMIN); with a second one it can', async () => {
  await seedUser('ad5', 'admin')
  const res = await del('ad5')
  expect(res.status).toBe(409)
  expect(await res.json()).toEqual({ error: 'LAST_ADMIN' })
  expect(await count("SELECT count(*) n FROM users WHERE id = 'ad5'")).toBe(1)
  await seedUser('ad6', 'admin')
  expect((await del('ad5')).status).toBe(200)
  expect(await count("SELECT count(*) n FROM users WHERE id = 'ad5'")).toBe(0)
  expect((await del('ad6')).status).toBe(409) // now ad6 is the last one
})

it('signed out is 401, an unconfirmed email is 403', async () => {
  await seedUser('ad7')
  expect((await del('ad7', EMAIL('ad7'), { 'content-type': 'application/json' })).status).toBe(401)
  const unverified = await del('ad7', EMAIL('ad7'), { cookie: `uid=ad7:${EMAIL('ad7')}; verified=0`, 'content-type': 'application/json' })
  expect(unverified.status).toBe(403)
  expect(await count("SELECT count(*) n FROM users WHERE id = 'ad7'")).toBe(1)
})

it('a failing object delete is logged by count and error name only and the answer stays 200', async () => {
  const a = await fullPerson('ad8')
  setStorageForTests({
    ...store,
    delete: async () => {
      throw new TypeError('secret-key-in-message')
    },
  })
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  const res = await del('ad8')
  setStorageForTests(store)
  expect(res.status).toBe(200)
  expect((await rowsOf('ad8', a.providerId)).users).toBe(0)
  const lines = log.mock.calls.map((c) => c.join(' ')).join('\n')
  log.mockRestore()
  expect(lines).toContain('4 of 4 objects could not be removed')
  expect(lines).toContain('TypeError')
  expect(lines).not.toContain('ad8')
  expect(lines).not.toContain('secret-key')
})

it('deleting twice is safe: the second call is not a 500', async () => {
  await fullPerson('ad9')
  expect((await del('ad9')).status).toBe(200)
  // The fake session still stands, so the first contact recreates an empty row, which the second delete removes again.
  expect((await del('ad9')).status).toBeLessThan(500)
  expect(await count("SELECT count(*) n FROM users WHERE id = 'ad9'")).toBe(0)
})
