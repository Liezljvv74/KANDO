import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

// A route must not reach the owner connection: no db, pool, appDb or appPool from @kando/db (RLS would be bypassed).
export const importsOwnerConnection = (src: string) =>
  [...src.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+['"]@kando\/db['"]/g)].some(
    (m) => !m[1] && m[2]!.split(',').some((n) => ['db', 'pool', 'appDb', 'appPool'].includes(n.trim().split(/\s+as\s+/)[0]!.replace(/^type\s+/, '').trim()) && !/^\s*type\s/.test(n)),
  ) || /import\s+[^;{]*\*\s+as\s+\w+\s+from\s+['"]@kando\/db['"]/.test(src)

it('the owner-connection check catches a bypass (negative fixture)', () => {
  expect(importsOwnerConnection("import { db } from '@kando/db'")).toBe(true)
  expect(importsOwnerConnection("import { users, pool as p } from '@kando/db'")).toBe(true)
  expect(importsOwnerConnection("import { appPool } from '@kando/db'")).toBe(true)
  expect(importsOwnerConnection("import { appDb as a } from '@kando/db'")).toBe(true)
  expect(importsOwnerConnection("import * as d from '@kando/db'")).toBe(true)
  expect(importsOwnerConnection("import { users } from '@kando/db'")).toBe(false)
  expect(importsOwnerConnection("import type { Tx } from '@kando/db'")).toBe(false)
})

// Stripe and translation routes hand the owner connection to an after-transaction answer, which runs with no request transaction open (the domain functions check ownership themselves).
const OWNER_AFTER_TRANSACTION = ['bookings/[id]/pay', 'payouts/setup', 'payouts/status', 'providers/[slug]/translation'].map((r) => `app-api/v1/${r}/route.ts`)
const root = join(__dirname, '../app/app-api')
const routes = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? routes(p) : n === 'route.ts' ? [p] : []
  })

it('every route file under app/app-api exports handlers built with appRequest', () => {
  const files = routes(root)
  expect(files.length).toBeGreaterThan(0)
  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    const exported = [...src.matchAll(/export\s+(?:async\s+)?(?:const|function)\s+(\w+)/g)].map((m) => m[1]!)
    const methods = exported.filter((n) => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(n))
    expect(methods.length, `${file} exports no HTTP method`).toBeGreaterThan(0)
    // anything else exported (besides route config) could bypass the wrapper
    expect(exported.filter((n) => !methods.includes(n) && !['runtime', 'dynamic', 'maxDuration'].includes(n)), file).toEqual([])
    for (const m of methods) {
      expect(src, `${file}: ${m}`).toMatch(new RegExp(`export\\s+const\\s+${m}\\s*=\\s*appRequest\\(`))
    }
    expect(importsOwnerConnection(src), `${file} imports db or pool`).toBe(OWNER_AFTER_TRANSACTION.some((r) => file.replaceAll('\\', '/').endsWith(r)))
    expect(/export\s*\{|export\s+default/.test(src), `${file} re-exports`).toBe(false)
  }
})
