import { DEFAULT_LANG, isLang, t as translate, type Key, type Lang } from '@kando/i18n'
import { getLocales } from 'expo-localization'
import * as SecureStore from 'expo-secure-store'
import { useSyncExternalStore } from 'react'

// The texts live in the shared catalogue (@kando/i18n); this module only keeps the app's current language.
export type { Key, Lang }

const LANG_KEY = 'skilled.lang'

const deviceLang = getLocales()[0]?.languageCode
let lang: Lang = isLang(deviceLang) ? deviceLang : DEFAULT_LANG
const listeners = new Set<() => void>()

function apply(next: Lang) {
  lang = next
  listeners.forEach((l) => l())
}

// A saved choice beats the device language.
SecureStore.getItemAsync(LANG_KEY)
  .then((saved) => {
    if (isLang(saved)) apply(saved)
  })
  .catch(() => {})

export const getLang = () => lang

export function setLang(next: Lang) {
  apply(next)
  SecureStore.setItemAsync(LANG_KEY, next).catch(() => {})
}

export const useLang = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    getLang,
  )

/** The catalogue text in the current language; `{name}` placeholders come from `params`. */
export const SUPPORT_EMAIL = 'info@skillweb.space'
export const t = (key: Key, params?: Record<string, string | number>) => translate(lang, key, { contact: SUPPORT_EMAIL, ...params })

export const errorKeys: Record<string, Key> = {
  // App API (`error`)
  'Unknown postcode': 'error.unknownPostcode',
  'Invalid postcode': 'error.invalidPostcode',
  'Unknown category': 'error.unknownCategory',
  'Profile incomplete': 'error.profileIncomplete',
  'Profile suspended': 'error.profileSuspended',
  'Create your profile first': 'error.createProfileFirst',
  'Not found': 'error.notFound',
  'Reference limit reached': 'error.referenceLimit',
  'File too large': 'error.fileTooLarge',
  'Payload too large': 'error.fileTooLarge',
  'Unsupported file type': 'error.unsupportedFile',
  'File unreadable': 'error.fileUnreadable',
  'Photo limit reached': 'error.photoLimit',
  'Profile photo required while published': 'error.photoRequired',
  'Check already pending': 'error.checkPending',
  'Translation unavailable': 'provider.translateError',
  network: 'error.network',
  'Server error': 'error.server',
  BAD_FORMAT: 'error.badFormat',
  EMAIL_MISMATCH: 'account.emailMismatch',
  LAST_ADMIN: 'account.lastAdmin',
  // Auth server (`code`)
  INVALID_EMAIL_OR_PASSWORD: 'error.invalidLogin',
  USER_ALREADY_EXISTS: 'error.emailTaken',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'error.emailTaken',
  EMAIL_NOT_VERIFIED: 'error.unverifiedEmail',
  INVALID_EMAIL: 'auth.invalidEmail',
  PASSWORD_TOO_SHORT: 'auth.fillAll',
  INVALID_OTP: 'auth.codeInvalid',
  OTP_EXPIRED: 'auth.codeInvalid',
  TOO_MANY_ATTEMPTS: 'auth.codeInvalid',
}

/** Maps a server machine string (ApiError.code) to text in the current language. */
/** Never the raw server text or a status number: a code that is not mapped gets the general message (5xx: the server one). */
export const errorText = (code: string): string => t(errorKeys[code] ?? (/^HTTP 5\d\d$/.test(code) ? 'error.server' : 'error.generic'))

const known = (key: string): key is Key => translate(DEFAULT_LANG, key as Key) !== key

/** Maps a `missing` item of a 409 'Profile incomplete' response to text; unknown items show the raw name. */
export const missingText = (item: string): string => {
  if (item === 'photo') return t('setup.photo') // inside a sentence; missing.photo is the capitalised name (buttons, alert titles)
  const key = `missing.${item}`
  return known(key) ? t(key) : item
}

/** Maps a required-document code to its name; unknown codes show the raw code. */
export const docText = (code: string): string => {
  const key = `doc.${code}`
  return known(key) ? t(key) : code
}
