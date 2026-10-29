import { de } from '@kando/i18n/src/de'
import { en } from '@kando/i18n/src/en'
import { accountError } from '@/lib/account-data'
import { errorKeys, errorText, setLang, t } from './index'

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

test('every booking rule code from the server has its own text in both languages', () => {
  const codes = ['not-your-turn', 'slot-pending', 'provider-unavailable', 'on-site-required', 'address-required', 'start-in-past', 'start-too-far', 'not-bookable', 'own-service', 'not-open', 'quote-expired', 'quote-not-open', 'request-closed', 'request-limit', 'daily-limit', 'Unknown service', 'TOO_FAR_AHEAD', 'PAY_WINDOW_TOO_SHORT', 'PAYMENTS_OFF', 'PROVIDER_NOT_READY', 'PAYOUT_SETUP_FIRST', 'ALREADY_BOOKABLE']
  for (const lang of ['de', 'en'] as const) {
    setLang(lang)
    for (const code of codes) expect(errorText(code)).not.toBe(errorText('unmapped'))
  }
  setLang('en')
  expect(errorText('slot-pending')).toContain('pending booking')
  expect(errorText('PAYMENTS_OFF')).toBe('Payments are not switched on yet')
})

test('the chat rejections have their own text in both languages', () => {
  for (const lang of ['de', 'en'] as const) {
    setLang(lang)
    expect(errorText('CONTACT_DETAILS')).toBe(t('chat.contactBlocked'))
    expect(errorText('BLOCKED')).toBe(t('chat.blocked'))
  }
})
