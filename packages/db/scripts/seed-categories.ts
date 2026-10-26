export {}
process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
const { pool } = await import('../src')
const { seedCategories } = await import('../src/seed/categories')
console.log(`seeded ${await seedCategories()} categories`)
await pool.end()
