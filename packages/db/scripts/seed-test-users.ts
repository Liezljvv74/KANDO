// Test customers and published providers on the dev branch only. Password for every account: TestPass123
export {}
const { assertDevBranch, neonAuth, seedTestUsers, TEST_PASSWORD } = await import('../src/seed/test-users')
assertDevBranch(process.env.NEON_BRANCH)
if (!process.env.NEON_AUTH_BASE_URL) throw new Error('NEON_AUTH_BASE_URL is not set')
process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
const { pool } = await import('../src')
const r = await seedTestUsers(neonAuth(process.env.NEON_AUTH_BASE_URL))
console.log(`created ${r.created} accounts, skipped ${r.skipped} (already there). Password: ${TEST_PASSWORD}`)
await pool.end()
