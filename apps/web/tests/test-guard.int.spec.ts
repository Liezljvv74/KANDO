import { expect, it, vi } from 'vitest'
import { assertTestDatabase } from '@kando/db/src/test/guard'

it('the test guard refuses a non-local or non-test URL', () => {
  const neon = 'postgresql://u:p@ep-steep-scene-b9p4f2v6.c-7.eu-central-1.aws.neon.tech/neondb?sslmode=require'
  expect(() => assertTestDatabase(neon)).toThrow()
  expect(() => assertTestDatabase('postgres://postgres:postgres@localhost:5433/other')).toThrow()
  vi.stubEnv('DATABASE_URL', 'postgres://postgres:postgres@localhost:5433/kando')
  expect(() => assertTestDatabase('postgres://postgres:postgres@localhost:5433/kando')).toThrow()
  vi.unstubAllEnvs()
  expect(() => assertTestDatabase('postgres://postgres:postgres@localhost:5433/kando')).not.toThrow()
  expect(() => assertTestDatabase('postgres://postgres:postgres@127.0.0.1:5433/kando')).not.toThrow()
})
