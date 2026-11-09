export {}
// The Help topics, upserted (the owner's approval flag is kept). Safe on dev; on any other database only with ALLOW_PRODUCTION=1.
process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
const { hostOf, isDevTarget } = await import('@kando/db/src/seed/guard')
console.log(`Database host: ${hostOf(process.env.DATABASE_URL)}\nNEON_BRANCH: ${process.env.NEON_BRANCH}`)
if (!isDevTarget(process.env) && process.env.ALLOW_PRODUCTION !== '1') {
  throw new Error('Not the dev branch and database: set ALLOW_PRODUCTION=1 to run here')
}
const { pool } = await import('@kando/db')
const { seedHelpTopics } = await import('../src/help/help')
console.log(`seeded ${await seedHelpTopics()} help topics`)
await pool.end()
