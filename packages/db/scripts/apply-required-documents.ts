export {}
// Sets the required and optional documents of the 14 seeded categories from the seed table, overwriting staff edits.
// One-off for a database that was seeded before the table existed. Same guard as seed-categories.
process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
const { hostOf, isDevTarget } = await import('../src/seed/guard')
console.log(`Database host: ${hostOf(process.env.DATABASE_URL)}\nNEON_BRANCH: ${process.env.NEON_BRANCH}`)
if (!isDevTarget(process.env) && process.env.ALLOW_PRODUCTION !== '1') {
  throw new Error('Not the dev branch and database: set ALLOW_PRODUCTION=1 to run here')
}
const { pool } = await import('../src')
const { applyDocumentLists } = await import('../src/seed/categories')
console.log(`updated ${await applyDocumentLists()} categories`)
await pool.end()
