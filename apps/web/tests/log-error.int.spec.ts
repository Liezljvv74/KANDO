import { expect, it } from 'vitest'
import { describeError } from '@kando/domain'

it('keeps name, a short message and the Postgres code; no email address survives', () => {
  const pg = Object.assign(new Error('duplicate key'), { code: '23505' })
  const query = Object.assign(new Error('Failed query: insert into users (email) values ($1) params: anna.muster@example.com'), { name: 'DrizzleQueryError', cause: pg })
  const text = describeError(query)
  expect(text).toBe('DrizzleQueryError: Failed query: insert into users (email) values ($1) params: [email] (postgres 23505)')
  expect(describeError(new Error('x'.repeat(500)))).toBe(`Error: ${'x'.repeat(200)}`)
  expect(describeError(new Error(`${'y'.repeat(190)} b.c@d.example`))).not.toMatch(/@|d\.example/)
  expect(describeError('plain Anna@example.com')).toBe('string: ')
  expect(describeError(null)).toBe('object: ')
})
