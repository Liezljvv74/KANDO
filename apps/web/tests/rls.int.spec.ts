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
  const r = await asUser(null, (tx) => tx.execute(sql`SELECT count(*)::int AS n FROM countries`))
  expect(r.rows).toHaveLength(1)
  await expect(
    asUser(null, (tx) => tx.execute(sql`INSERT INTO currencies (code, minor_units) VALUES ('XXX', 2)`)),
  ).rejects.toMatchObject({ cause: { message: expect.stringContaining("permission denied") } })
})
