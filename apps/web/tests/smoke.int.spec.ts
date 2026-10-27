import pg from 'pg'
import { expect, it } from 'vitest'

const url = process.env.DATABASE_URL_TEST ?? 'postgres://postgres:postgres@localhost:5433/kando'

it('connects to the test database and sees PostGIS', async () => {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    const { rows } = await client.query('SELECT postgis_version() AS v')
    expect(typeof rows[0].v).toBe('string')
  } finally {
    await client.end()
  }
})
