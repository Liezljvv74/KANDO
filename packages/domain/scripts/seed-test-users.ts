export {}
// Test customers and published providers on the dev branch and database only. Accounts come from the git-ignored
// packages/domain/seed-data/test-users.json (copy test-users.example.json to start).
process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
const { assertDevTarget, hostOf } = await import('@kando/db/src/seed/guard')
assertDevTarget(process.env)
console.log(`Database host: ${hostOf(process.env.DATABASE_URL)}\nNEON_BRANCH: ${process.env.NEON_BRANCH}`)
if (!process.env.NEON_AUTH_BASE_URL) throw new Error('NEON_AUTH_BASE_URL is not set')
const { pool } = await import('@kando/db')
const { loadSeedData, neonAuth, seedTestUsers } = await import('../src/seed/test-users')
const data = loadSeedData()
const r = await seedTestUsers(neonAuth(process.env.NEON_AUTH_BASE_URL), process.env, data)
console.log(`created ${r.created} accounts, skipped ${r.skipped} (already there), all marked verified. Password: ${data.password}`)
await pool.end()
