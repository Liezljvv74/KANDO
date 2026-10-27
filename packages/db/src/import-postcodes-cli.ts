export {}
import { fileURLToPath } from 'node:url'

process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
const { importPostcodes, pool } = await import('./index')
const file = fileURLToPath(new URL('../data/postcodes-de.tsv', import.meta.url))
console.log(`imported ${await importPostcodes('DE', file)} postcodes`)
await pool.end()
