import { docText, errorText, setLang, t } from './index'

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
}))

test('texts come from the shared catalogue, in the chosen language, with placeholders filled', () => {
  setLang('de')
  expect(t('auth.back')).toBe('Zurück zur Anmeldung')
  expect(t('brand.tagline')).toBe('Fachleute in deiner Nähe finden')
  expect(t('myProfile.portfolioCount', { n: 2, max: 6 })).toBe('2 von 6')
  setLang('en')
  expect(t('myProfile.portfolioMax', { max: 6 })).toBe('You can add at most 6 photos.')
})

test('the translate button texts exist in both languages', () => {
  setLang('de')
  expect(t('provider.translate')).toBe('Übersetzen')
  expect(t('provider.translatedLabel')).toBe('Automatisch übersetzt (KI) · Original anzeigen')
  expect(t('provider.translateError')).toContain('Übersetzung ist gerade nicht verfügbar.')
  setLang('en')
  expect(t('provider.translate')).toBe('Translate')
  expect(t('provider.translatedLabel')).toBe('Automatically translated (AI) · Show original')
  expect(t('provider.translateError')).toContain('Translation is not available right now.')
})

test('errorText maps the auth server codes to catalogue messages', () => {
  setLang('en')
  expect(errorText('INVALID_EMAIL_OR_PASSWORD')).toContain('Email or password is incorrect.')
  expect(errorText('USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL')).toContain('An account with this email address already exists.')
  expect(errorText('USER_ALREADY_EXISTS')).toContain('An account with this email address already exists.')
  for (const code of ['INVALID_OTP', 'OTP_EXPIRED', 'TOO_MANY_ATTEMPTS']) expect(errorText(code)).toContain('The code is wrong or has expired.')
  expect(errorText('EMAIL_NOT_VERIFIED')).toMatch(/not confirmed yet/)
  expect(errorText('INVALID_EMAIL')).toMatch(/does not look right/)
  expect(errorText('network')).toMatch(/Cannot reach the server/)
  expect(errorText('Could not verify the token')).toMatch(/Something went wrong/)
  setLang('de')
  expect(errorText('INVALID_EMAIL_OR_PASSWORD')).toContain('E-Mail oder Passwort ist falsch.')
})

test('errorText maps the app API strings', () => {
  setLang('en')
  expect(errorText('Unknown postcode')).toContain('We do not know this postcode')
  expect(errorText('Invalid postcode')).toContain('not written correctly')
  expect(errorText('Reference limit reached')).toContain('You can list at most 2 past jobs.')
  expect(errorText('Translation unavailable')).toContain('Translation is not available right now.')
})

test('docText maps known document codes and passes unknown ones through', () => {
  setLang('en')
  expect(docText('police-certificate')).toBe('Extended police certificate')
  expect(docText('permit')).toBe('Permit')
  expect(docText('xyz')).toBe('xyz')
  setLang('de')
  expect(docText('permit')).toBe('Genehmigung')
})
