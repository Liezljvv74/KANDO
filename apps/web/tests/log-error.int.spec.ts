import { expect, it } from 'vitest'
import { describeError } from '@kando/domain'

const failed = (cause: object) =>
  Object.assign(
    new Error('Failed query: insert into "users" ("first_name", "email") values ($1, $2)\nparams: Anna Muster,anna.muster@example.com'),
    { name: 'DrizzleQueryError', cause },
  )

it('a failed Drizzle query logs no SQL text and no parameters: name, Postgres code and the cause message only', () => {
  const pg = Object.assign(new Error('duplicate key value violates unique constraint "users_email_key"'), { code: '23505', detail: 'Key (email)=(anna.muster@example.com) already exists.' })
  const text = describeError(failed(pg))
  expect(text).toBe('DrizzleQueryError: duplicate key value violates unique constraint "users_email_key" (postgres 23505)')
  expect(text).not.toMatch(/Anna|Muster|@|params|insert/i)
})

it('the Postgres detail pattern Key (col)=(value) is scrubbed', () => {
  const text = describeError(Object.assign(new Error('duplicate key. Key (email)=(anna@example.com) already exists.'), { code: '23505' }))
  expect(text).not.toMatch(/anna|example/)
  expect(text).toContain('(postgres 23505)')
})

it('keeps name, a short message and the Postgres code; no email address survives', () => {
  expect(describeError(Object.assign(new Error('boom for b.c@d.example'), { code: '23505' }))).toBe('Error: boom for [email] (postgres 23505)')
  expect(describeError(new Error('x'.repeat(500)))).toBe(`Error: ${'x'.repeat(200)}`)
  expect(describeError(new Error(`${'y'.repeat(190)} b.c@d.example`))).not.toMatch(/@|d\.example/)
  expect(describeError('plain Anna@example.com')).toBe('string: ')
  expect(describeError(null)).toBe('object: ')
})
