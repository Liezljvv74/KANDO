export {}
// Migrations use the direct (unpooled) connection.
process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
const { migrate, pool } = await import('./index')
await migrate()
await pool.end()
console.log('migrated')
