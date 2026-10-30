import { expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = join(__dirname, '..', '..', '..')
const ALLOWED = new Set(['NODE_ENV', 'VITEST', 'TZ', 'VERCEL_PROJECT_PRODUCTION_URL', 'EXPO_PUBLIC_API_URL', 'Stripe_Secret_Key'])

function* sources(dir: string): Generator<string> {
  for (const f of readdirSync(dir)) {
    if (['node_modules', '.next', 'dist', '.expo', 'drizzle'].includes(f)) continue
    const p = join(dir, f)
    if (statSync(p).isDirectory()) yield* sources(p)
    else if (/\.(ts|tsx|js|mjs)$/.test(f)) yield p
  }
}

it('every process.env name used in the code is in .env.example', () => {
  const example = readFileSync(join(root, '.env.example'), 'utf8')
  const documented = new Set([...example.matchAll(/^([A-Za-z_][A-Za-z0-9_]*)=/gm)].map((m) => m[1]))
  const missing = new Set<string>()
  for (const top of ['apps', 'packages'])
    for (const file of sources(join(root, top)))
      for (const m of readFileSync(file, 'utf8').matchAll(/process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g))
        if (!ALLOWED.has(m[1]!) && !documented.has(m[1]!)) missing.add(m[1]!)
  expect([...missing].sort()).toEqual([])
})
