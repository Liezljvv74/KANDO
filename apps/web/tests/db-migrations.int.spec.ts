import { expect, it } from 'vitest'
import { classifyTables, migrate, pool } from '@kando/db'

it('migrates an empty database and classifies every table', async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE')
  await migrate()
  expect(classifyTables()).toEqual({ unclassified: [], duplicated: [] })
  const { rows } = await pool.query("SELECT 1 FROM pg_roles WHERE rolname = 'app_user'")
  expect(rows).toHaveLength(1)
  await migrate() // idempotent
})
