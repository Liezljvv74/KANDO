import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { expect, it } from 'vitest'

// Signed-out people may browse (read) but never transact: a write (POST, PUT, PATCH, DELETE) must require a session,
// except the routes below, each with its reason. `auth` has no default, so every route states it.
const WRITES_WITHOUT_SESSION: Record<string, string> = {
  'feedback/route.ts': 'the feedback form is open to everyone; it moves no money and books nothing',
}

const root = join(__dirname, '../app/app-api/v1')
const routes = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? routes(p) : n === 'route.ts' ? [p] : []
  })

/** Every exported handler with the auth option of its appRequest call. */
const handlers = (src: string) =>
  [...src.matchAll(/export const (GET|POST|PUT|PATCH|DELETE) = appRequest\(\s*\{([^}]*)\}/g)].map((m) => ({
    method: m[1]!,
    auth: /auth:\s*'(required|optional)'/.exec(m[2]!)?.[1],
  }))

it('the scan sees optional and required handlers (negative fixture)', () => {
  expect(handlers("export const GET = appRequest({ auth: 'optional' }, async () => {})")).toEqual([{ method: 'GET', auth: 'optional' }])
  expect(handlers("export const POST = appRequest({ auth: 'required', maxBodyBytes: 8 }, async () => {})")).toEqual([{ method: 'POST', auth: 'required' }])
})

/** Every HTTP method a route file exports, however it is written. */
export const exportedMethods = (src: string) => [...src.matchAll(/export\s+(?:async\s+)?(?:const|function|let|var)\s+(GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]!)

it('the scan reads every exported handler: one written another way fails here, not silently', () => {
  expect(exportedMethods('export async function POST() {}')).toEqual(['POST'])
  expect(exportedMethods('export const DELETE = wrap(appRequest(opts, fn))')).toEqual(['DELETE'])
  for (const file of routes(root)) {
    const src = readFileSync(file, 'utf8')
    expect(handlers(src).map((h) => h.method).sort(), relative(root, file)).toEqual(exportedMethods(src).sort())
  }
})

it('every handler states its auth', () => {
  for (const file of routes(root)) {
    for (const h of handlers(readFileSync(file, 'utf8'))) {
      expect(h.auth, `${relative(root, file)} ${h.method}`).toBeDefined()
    }
  }
})

it('no write route works without a session, except the listed ones', () => {
  const open = routes(root).flatMap((file) =>
    handlers(readFileSync(file, 'utf8'))
      .filter((h) => h.method !== 'GET' && h.auth === 'optional')
      .map(() => relative(root, file).replaceAll('\\', '/')),
  )
  expect([...new Set(open)].sort()).toEqual(Object.keys(WRITES_WITHOUT_SESSION).sort())
})

it('the browse routes answer without a session', () => {
  const optional = routes(root)
    .filter((file) => handlers(readFileSync(file, 'utf8')).some((h) => h.method === 'GET' && h.auth === 'optional'))
    .map((file) => relative(root, file).replaceAll('\\', '/'))
  for (const r of ['categories/route.ts', 'help/route.ts', 'providers/route.ts', 'providers/[slug]/route.ts']) expect(optional).toContain(r)
})
