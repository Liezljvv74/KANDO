import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { expect, it } from 'vitest'

// Raw SQL text skips Drizzle's parameter binding. Only these files may build it, from constants, never from input.
const ALLOWED = ['packages/db/src/rls.ts', 'packages/db/src/as-user.ts', 'packages/domain/src/providers/profile.ts']
const root = join(__dirname, '../../..')

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (['node_modules', '.next', '.expo', 'dist'].includes(e.name)) return []
    const path = join(dir, e.name)
    return e.isDirectory() ? sources(path) : /\.(ts|tsx|mts)$/.test(e.name) ? [path] : []
  })
}

it('sql.raw( is used only in the allow-listed files (test files aside)', () => {
  const offenders = [...sources(join(root, 'apps')), ...sources(join(root, 'packages'))]
    .map((f) => relative(root, f).split(sep).join('/'))
    .filter((f) => !f.includes('/tests/') && !/\.(spec|test)\./.test(f) && !ALLOWED.includes(f)) // app code only; tests build their own fixtures
    .filter((f) => readFileSync(join(root, f), 'utf8').includes('sql.raw('))
  expect(offenders).toEqual([])
})

it('the allow-list is not stale: every listed file still uses sql.raw(', () => {
  for (const f of ALLOWED) expect(readFileSync(join(root, f), 'utf8')).toContain('sql.raw(')
})
