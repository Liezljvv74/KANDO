// Vitest global setup: fresh `public` schema on the test database, migrated once per run.
process.env.NODE_ENV = 'test'

export default async function setup(): Promise<void> {
  const { migrate, pool } = await import('../index')
  await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await migrate()
  await pool.end()
}
