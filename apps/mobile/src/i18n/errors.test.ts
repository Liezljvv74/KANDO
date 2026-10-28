import { de } from '@kando/i18n/src/de'
import { en } from '@kando/i18n/src/en'
import { accountError } from '@/lib/account-data'
import { errorKeys, errorText, setLang } from './index'

test('every mapped error code has a non-empty German and English text', () => {
  for (const key of Object.values(errorKeys)) {
    expect((de as Record<string, string>)[key]?.trim()).toBeTruthy()
    expect((en as Record<string, string>)[key]?.trim()).toBeTruthy()
  }
})

test('unmapped codes and server statuses never show raw text or numbers', () => {
  setLang('en')
  expect(errorText('HTTP 429')).toBe(errorText(''))
  expect(errorText('something raw from the server')).not.toContain('raw')
  expect(errorText('HTTP 502')).toBe(errorText('Server error'))
  expect(errorText('HTTP 502')).not.toMatch(/\d{3}/)
})

test('the delete and export texts say what happened and have no status numbers', () => {
  for (const lang of ['en', 'de'] as const) {
    setLang(lang)
    for (const text of [accountError('delete', 'EMAIL_MISMATCH'), accountError('delete', 'LAST_ADMIN'), accountError('delete', 'network'), accountError('delete', 'HTTP 500'), accountError('export', 'network'), accountError('export', 'EMAIL_MISMATCH')]) {
      expect(text).not.toMatch(/\b\d{3}\b|HTTP/)
      expect(text.length).toBeGreaterThan(40)
    }
  }
  setLang('en')
  expect(accountError('delete', 'LAST_ADMIN')).toContain('another person Administrator')
  expect(accountError('delete', 'network')).toContain('not deleted')
  expect(accountError('delete', 'network')).toContain('info@skillweb.space') // the {contact} placeholder is filled
  expect(accountError('export', 'EMAIL_MISMATCH')).toContain('could not be exported') // a delete code never shows on export
})
