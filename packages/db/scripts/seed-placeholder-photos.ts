// A generated photo for every published profile without one. Dev branch at once; elsewhere ALLOW_PRODUCTION=1 and a typed yes.
import { createInterface } from 'node:readline/promises'

const { confirmedOrDev } = await import('../src/seed/placeholder-photos')
const hostOf = (url?: string) => {
  try {
    return new URL(url ?? '').host
  } catch {
    return '(unset)'
  }
}
console.log(`Database host: ${hostOf(process.env.DATABASE_URL)}\nStorage host: ${hostOf(process.env.AWS_ENDPOINT)}\nNEON_BRANCH: ${process.env.NEON_BRANCH}`)
await confirmedOrDev(process.env.NEON_BRANCH, process.env, async () => {
  if (!process.stdin.isTTY) throw new Error('Not the dev branch and no terminal to confirm in')
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question('Add placeholder photos to THIS database? Check the hosts above. Type yes: ')
  rl.close()
  return answer
})
process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
const { pool } = await import('../src')
const { addPlaceholderPhotos } = await import('../src/seed/placeholder-photos')
console.log(`added ${await addPlaceholderPhotos()} placeholder photos`)
await pool.end()
