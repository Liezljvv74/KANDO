import { afterAll, beforeAll, expect, it } from 'vitest'
import { asUser, PRIVATE_TABLES, applyRls, pool, rlsStatements } from '@kando/db'
import { sql } from 'drizzle-orm'

beforeAll(async () => {
  await pool.query('CREATE TABLE rls_probe (id serial PRIMARY KEY, owner_id text NOT NULL, note text)')
  await pool.query("INSERT INTO rls_probe (owner_id, note) VALUES ('a', 'secret a'), ('b', 'secret b')")
  PRIVATE_TABLES.rls_probe = 'owner_id = app_current_user_id()'
  for (const s of rlsStatements(['rls_probe'])) await pool.query(s)
})

afterAll(async () => {
  delete PRIVATE_TABLES.rls_probe
  await pool.query('DROP TABLE IF EXISTS rls_probe')
  await applyRls()
})

it('app_user cannot read a private table row of another user', async () => {
  const a = await asUser('a', (tx) => tx.execute(sql`SELECT note FROM rls_probe`))
  expect(a.rows.map((r) => r.note)).toEqual(['secret a'])
  const anon = await asUser(null, (tx) => tx.execute(sql`SELECT note FROM rls_probe`))
  expect(anon.rows).toEqual([])
  const upd = await asUser('a', (tx) => tx.execute(sql`UPDATE rls_probe SET note = 'x' WHERE owner_id = 'b'`))
  expect(upd.rowCount).toBe(0)
})

it('public reference tables are readable by app_user and not writable', async () => {
  const r = await asUser(null, (tx) => tx.execute(sql`SELECT code FROM countries WHERE code = 'DE'`))
  expect(r.rows).toEqual([{ code: 'DE' }])
  await expect(
    asUser(null, (tx) => tx.execute(sql`INSERT INTO currencies (code, minor_units) VALUES ('XXX', 2)`)),
  ).rejects.toMatchObject({ cause: { message: expect.stringContaining("permission denied") } })
})

it('app_user can neither read nor write translation_requests and cannot insert translations', async () => {
  const denied = (q: ReturnType<typeof sql>) => expect(asUser('x', (tx) => tx.execute(q))).rejects.toMatchObject({ cause: { message: expect.stringContaining('permission denied') } })
  await denied(sql`SELECT * FROM translation_requests`)
  await denied(sql`INSERT INTO translation_requests (client_key) VALUES ('x')`)
  await denied(sql`INSERT INTO translations (key, lang, text) VALUES ('k', 'de', 't')`)
  await asUser('x', (tx) => tx.execute(sql`SELECT * FROM translations LIMIT 1`))
})

const ids = ['rl-cust', 'rl-other', 'rl-na', 'rl-nb']
const cleanupPeople = async () => {
  await pool.query('DELETE FROM notifications WHERE user_id = ANY($1)', [ids])
  await pool.query('DELETE FROM photos WHERE owner_id = ANY($1)', [ids])
  await pool.query('DELETE FROM providers WHERE owner_id = ANY($1)', [ids])
  await pool.query('DELETE FROM users WHERE id = ANY($1)', [ids])
}
const photosOf = (uid: string | null) => asUser(uid, async (tx) => (await tx.execute(sql`SELECT id FROM photos WHERE owner_id = 'rl-cust'`)).rows)
const providerOf = (uid: string | null) => asUser(uid, async (tx) => (await tx.execute(sql`SELECT id FROM providers WHERE owner_id = 'rl-cust'`)).rows)

it("a person's picture is private until the owner's provider is published and not suspended", async () => {
  for (const id of ids) await pool.query('INSERT INTO users (id, email) VALUES ($1, $2)', [id, `${id}@test.skilled.invalid`])
  try {
    await pool.query("INSERT INTO photos (owner_id, kind, key, width, height) VALUES ('rl-cust', 'profile', 'users/rl-cust/p.jpg', 1, 1)")
    expect(await photosOf('rl-cust')).toHaveLength(1)
    expect(await photosOf('rl-other')).toHaveLength(0)
    expect(await photosOf(null)).toHaveLength(0)
    await pool.query("INSERT INTO providers (owner_id, type) VALUES ('rl-cust', 'private')") // a draft: still private
    expect(await photosOf(null)).toHaveLength(0)
    await pool.query("UPDATE providers SET status = 'published' WHERE owner_id = 'rl-cust'")
    expect(await photosOf(null)).toHaveLength(1)
    expect(await photosOf('rl-other')).toHaveLength(1)
    await pool.query("UPDATE providers SET suspended_until = now() + interval '1 day' WHERE owner_id = 'rl-cust'")
    expect(await photosOf(null)).toHaveLength(0)
    expect(await providerOf(null)).toHaveLength(0)
    await pool.query("UPDATE providers SET suspended_until = now() - interval '1 minute' WHERE owner_id = 'rl-cust'")
    expect(await providerOf(null)).toHaveLength(1) // the date has passed: visible again
    expect(await photosOf(null)).toHaveLength(1)
  } finally {
    await cleanupPeople()
  }
})

it('notifications: the owner reads and marks own rows; another user sees none, cannot insert or change kind', async () => {
  await applyRls() // beforeAll's probe-only run revoked the write grants of every other table
  for (const id of ids) await pool.query('INSERT INTO users (id, email) VALUES ($1, $2)', [id, `${id}@test.skilled.invalid`])
  try {
    const id = (
      await pool.query("INSERT INTO notifications (user_id, kind, payload) VALUES ('rl-na', 'profile-live', '{\"url\":\"https://x.test/p\"}') RETURNING id")
    ).rows[0].id
    const mine = await asUser('rl-na', (tx) => tx.execute(sql`SELECT kind, payload FROM notifications`))
    expect(mine.rows).toEqual([{ kind: 'profile-live', payload: { url: 'https://x.test/p' } }])
    const seen = await asUser('rl-na', (tx) => tx.execute(sql`UPDATE notifications SET seen_at = now(), dismissed_at = now() WHERE id = ${id}`))
    expect(seen.rowCount).toBe(1)
    expect((await asUser('rl-nb', (tx) => tx.execute(sql`SELECT id FROM notifications`))).rows).toEqual([])
    const theirs = await asUser('rl-nb', (tx) => tx.execute(sql`UPDATE notifications SET dismissed_at = NULL WHERE id = ${id}`))
    expect(theirs.rowCount).toBe(0)
    const denied = { cause: { message: expect.stringContaining('permission denied') } }
    await expect(
      asUser('rl-nb', (tx) => tx.execute(sql`INSERT INTO notifications (user_id, kind, payload) VALUES ('rl-nb', 'profile-live', '{}')`)),
    ).rejects.toMatchObject(denied)
    await expect(asUser('rl-na', (tx) => tx.execute(sql`UPDATE notifications SET kind = 'x' WHERE id = ${id}`))).rejects.toMatchObject(denied)
    await expect(
      pool.query("INSERT INTO notifications (user_id, kind, payload) VALUES ('rl-na', 'other', '{}')"),
    ).rejects.toThrow(/notifications_kind_check/)
  } finally {
    await cleanupPeople()
  }
})

it('applyRls is all or nothing', async () => {
  await expect(applyRls([`DROP POLICY owner_only ON "users"`, 'SELECT no_such_function()'])).rejects.toThrow()
  const r = await pool.query("SELECT 1 FROM pg_policies WHERE tablename = 'users' AND policyname = 'owner_only'")
  expect(r.rowCount).toBe(1)
})
