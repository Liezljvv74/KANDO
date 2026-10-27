import { expect, it } from 'vitest'
import { assertTestDatabase } from '@kando/db/src/test/guard'
import { applyRls, classifyTables, migrate, pool } from '@kando/db'

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
