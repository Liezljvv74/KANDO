import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrate as drizzleMigrate } from 'drizzle-orm/node-postgres/migrator'
import { sql } from 'drizzle-orm'
import { expect, it } from 'vitest'
import { assertTestDatabase } from '@kando/db/src/test/guard'
import { applyRls, asUser, classifyTables, db, migrate, pool } from '@kando/db'
import { adminGet, getMyProfile } from '@kando/domain'

it('migrates an empty database and classifies every table', async () => {
  assertTestDatabase(pool.options.connectionString!)
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE')
  await migrate()
  expect(classifyTables()).toEqual({ unclassified: [], duplicated: [] })
  const { rows } = await pool.query("SELECT 1 FROM pg_roles WHERE rolname = 'app_user'")
  expect(rows).toHaveLength(1)
  await migrate() // idempotent
}, 30_000)

const columns = async (table: string) =>
  Object.fromEntries(
    (
      await pool.query(
        "SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1",
        [table],
      )
    ).rows.map((r) => [r.column_name, r.is_nullable === 'YES']),
  )

it('0008: person fields on users, suspensions by date, drafts allowed, notifications; applyRls succeeds', async () => {
  const users = await columns('users')
  for (const c of ['first_name', 'last_name', 'address_street', 'address_postcode', 'address_city', 'address_country']) expect(users[c], c).toBe(true)
  expect(users).not.toHaveProperty('name')
  const providers = await columns('providers')
  expect(providers.suspended_until).toBe(true)
  expect(providers.type).toBe(true)
  for (const c of ['display_name', 'photo_id', 'suspended']) expect(providers, c).not.toHaveProperty(c)
  const services = await columns('services')
  expect([services.price_type, services.price]).toEqual([true, true])
  expect((await columns('photos')).provider_id).toBe(true)
  expect(Object.keys(await columns('notifications')).sort()).toEqual(
    ['created_at', 'dismissed_at', 'id', 'kind', 'payload', 'seen_at', 'user_id'].sort(),
  )
  await expect(applyRls()).resolves.toBeUndefined() // a function still reading a dropped column fails here
})

it('photos: a profile photo has no provider, a portfolio photo has one, one profile photo per person', async () => {
  await pool.query("INSERT INTO users (id, email) VALUES ('dm-1', 'dm-1@test.skilled.invalid')")
  const pid = (await pool.query("INSERT INTO providers (owner_id) VALUES ('dm-1') RETURNING id")).rows[0].id
  const photo = (providerId: string | null, kind: string) =>
    pool.query("INSERT INTO photos (owner_id, provider_id, kind, key, width, height) VALUES ('dm-1', $1, $2, 'k', 1, 1)", [providerId, kind])
  try {
    await expect(photo(pid, 'profile')).rejects.toThrow(/photos_profile_provider_check/)
    await expect(photo(null, 'portfolio')).rejects.toThrow(/photos_profile_provider_check/)
    await photo(null, 'profile')
    await expect(photo(null, 'profile')).rejects.toThrow(/photos_one_profile_idx/)
    await photo(pid, 'portfolio')
  } finally {
    await pool.query("DELETE FROM photos WHERE owner_id = 'dm-1'")
    await pool.query("DELETE FROM providers WHERE owner_id = 'dm-1'")
    await pool.query("DELETE FROM users WHERE id = 'dm-1'")
  }
})

it('0008 on a database with data: a suspended provider stays hidden, a published one without names or picture goes back to draft', async () => {
  assertTestDatabase(pool.options.connectionString!)
  const src = join(process.cwd(), '../../packages/db/migrations')
  const upTo7 = mkdtempSync(join(tmpdir(), 'mig7-'))
  cpSync(src, upTo7, { recursive: true })
  const journalPath = join(upTo7, 'meta/_journal.json')
  const journal = JSON.parse(readFileSync(journalPath, 'utf8'))
  journal.entries = journal.entries.filter((e: { tag: string }) => !e.tag.startsWith('0008'))
  writeFileSync(journalPath, JSON.stringify(journal))
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE')
  await drizzleMigrate(db, { migrationsFolder: upTo7 })
  await pool.query(`INSERT INTO users (id, email, suspended_until) VALUES
    ('m8-pub', 'm8-pub@test.skilled.invalid', NULL),
    ('m8-sus', 'm8-sus@test.skilled.invalid', now() + interval '5 days'),
    ('m8-susnodate', 'm8-susnodate@test.skilled.invalid', NULL),
    ('m8-draft', 'm8-draft@test.skilled.invalid', NULL)`)
  await pool.query(`INSERT INTO providers (owner_id, type, display_name, status, suspended) VALUES
    ('m8-pub', 'private', 'P', 'published', false),
    ('m8-sus', 'private', 'S', 'published', true),
    ('m8-susnodate', 'private', 'N', 'published', true),
    ('m8-draft', 'private', 'D', 'draft', false)`)
  const pid = (await pool.query("SELECT id FROM providers WHERE owner_id = 'm8-pub'")).rows[0].id
  await pool.query("INSERT INTO photos (owner_id, provider_id, kind, key, width, height) VALUES ('m8-pub', $1, 'profile', 'k', 1, 1)", [pid])
  await migrate()
  const rows = (await pool.query("SELECT owner_id, status, suspended_until, suspended_until > now() + interval '365 days' AS for_good FROM providers WHERE owner_id LIKE 'm8-%' ORDER BY owner_id")).rows
  const by = Object.fromEntries(rows.map((r) => [r.owner_id, r]))
  expect(by['m8-sus'].suspended_until.getTime()).toBeGreaterThan(Date.now() + 4 * 86_400_000) // the owner's end date carried over
  expect(by['m8-susnodate'].for_good).toBe(true) // no date known: still hidden
  expect(by['m8-pub'].suspended_until).toBeNull()
  expect(rows.map((r) => r.status)).toEqual(['draft', 'draft', 'draft', 'draft']) // no names, no pictures after the migration
  // the legacy rows go through the domain mappers: a date Node cannot read would throw here
  for (const id of ['m8-sus', 'm8-susnodate']) {
    expect((await asUser(id, (tx) => getMyProfile(tx, id)))!.suspendedUntil).toEqual(expect.any(String))
    const pid = (await pool.query('SELECT id FROM providers WHERE owner_id = $1', [id])).rows[0].id
    const res = await db.transaction((tx) => adminGet(tx, 'providers', pid) as Promise<Response>)
    expect(res.status).toBe(200)
    expect(new Date((await res.json()).data.suspendedUntil).getTime()).toBeGreaterThan(Date.now())
  }
  // still suspended: published and complete it stays hidden from the public, an unsuspended one is visible
  await pool.query("UPDATE providers SET status = 'published', slug = owner_id WHERE owner_id IN ('m8-pub', 'm8-sus', 'm8-susnodate')")
  const visible = await asUser(null, (tx) => tx.execute(sql`SELECT slug FROM providers WHERE owner_id LIKE 'm8-%'`))
  expect(visible.rows.map((r) => r.slug)).toEqual(['m8-pub'])
  await pool.query("DELETE FROM providers WHERE owner_id LIKE 'm8-%'")
  await pool.query("DELETE FROM users WHERE id LIKE 'm8-%'")
}, 60_000)
