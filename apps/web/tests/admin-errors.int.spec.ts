import { expect, it } from 'vitest'
import { friendlyError } from '../lib/admin/data-provider'

it('a failed back-office request says what happened and what to do next, in the back office language', () => {
  expect(friendlyError('en', 404)).toBe('This item no longer exists.')
  expect(friendlyError('de', 404)).toBe('Dieser Eintrag existiert nicht mehr.')
  expect(friendlyError('en', 403)).toContain('Sign in again')
  expect(friendlyError('de', 401)).toContain('Melde Dich erneut an')
  expect(friendlyError('en', 409, 'Slug already exists')).toContain('(Slug already exists). Check the entry and try again.')
  expect(friendlyError('de', 400, 'Invalid input')).toContain('(Invalid input)')
  // a 5xx, no answer (status 0) and a 400 without a detail all end with the retry advice
  for (const [status, detail] of [[500, 'x'], [0, undefined], [400, undefined]] as const) {
    expect(friendlyError('en', status, detail)).toContain('Refresh the page to check, then try again')
    expect(friendlyError('de', status, detail)).toContain('Lade die Seite neu')
  }
})
