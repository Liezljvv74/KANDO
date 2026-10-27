export {}
// Test customers and published providers on the dev branch and database only. Password for every account: TestPass123
process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
const { assertDevTarget, hostOf } = await import('@kando/db/src/seed/guard')
assertDevTarget(process.env)
console.log(`Database host: ${hostOf(process.env.DATABASE_URL)}\nNEON_BRANCH: ${process.env.NEON_BRANCH}`)
if (!process.env.NEON_AUTH_BASE_URL) throw new Error('NEON_AUTH_BASE_URL is not set')
const { pool } = await import('@kando/db')
const { neonAuth, seedTestUsers, TEST_PASSWORD } = await import('../src/seed/test-users')
const r = await seedTestUsers(neonAuth(process.env.NEON_AUTH_BASE_URL))
console.log(`created ${r.created} accounts, skipped ${r.skipped} (already there), all marked verified. Password: ${TEST_PASSWORD}`)
await pool.end()
