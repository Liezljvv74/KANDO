import { DEFAULT_LANG, isLang, t as translate, type Key, type Lang } from '@kando/i18n'
import { getLocales } from 'expo-localization'
import * as SecureStore from 'expo-secure-store'
import { useSyncExternalStore } from 'react'

import app from '../../app.json'

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
// The support address is one setting, in app.json (expo.extra.supportEmail), like the product name: never typed into a text.
export const SUPPORT_EMAIL = app.expo.extra.supportEmail
export const t = (key: Key, params?: Record<string, string | number>) => translate(lang, key, { contact: SUPPORT_EMAIL, ...params })

export const errorKeys: Record<string, Key> = {
  // App API (`error`)
  'Unknown postcode': 'error.unknownPostcode',
  'Invalid postcode': 'error.invalidPostcode',
  'Unknown category': 'error.unknownCategory',
  'Profile incomplete': 'error.profileIncomplete',
  'Profile suspended': 'error.profileSuspended',
  SUSPENDED: 'error.accountSuspended',
  'Create your profile first': 'error.createProfileFirst',
  'Not found': 'error.notFound',
  'Reference limit reached': 'error.referenceLimit',
  'File too large': 'error.fileTooLarge',
  'Payload too large': 'error.fileTooLarge',
  'Unsupported file type': 'error.unsupportedFile',
  'File unreadable': 'error.fileUnreadable',
  'Photo limit reached': 'error.photoLimit',
  'Check already pending': 'error.checkPending',
  'Translation unavailable': 'provider.translateError',
  network: 'error.network',
  'Server error': 'error.server',
  BAD_FORMAT: 'error.badFormat',
  WRONG_PASSWORD: 'account.wrongPassword',
  AUTH_BUSY: 'error.authBusy',
  LAST_ADMIN: 'account.lastAdmin',
  REPLACEMENT_FIRST: 'error.replacementFirst',
  // Booking rules (`error`)
  'not-your-turn': 'error.booking.not-your-turn',
  'slot-pending': 'error.booking.slot-pending',
  'provider-unavailable': 'error.booking.provider-unavailable',
  'on-site-required': 'error.booking.on-site-required',
  'address-required': 'error.booking.address-required',
  'start-in-past': 'error.booking.start-in-past',
  'start-too-far': 'error.booking.start-too-far',
  'not-bookable': 'error.booking.not-bookable',
  'own-service': 'error.booking.own-service',
  'not-open': 'error.booking.not-open',
  'quote-expired': 'error.booking.quote-expired',
  'quote-not-open': 'error.booking.quote-not-open',
  'request-closed': 'error.booking.request-closed',
  'request-limit': 'error.booking.request-limit',
  'daily-limit': 'error.booking.daily-limit',
  'Unknown service': 'error.booking.unknown-service',
  TOO_FAR_AHEAD: 'error.booking.too-far-ahead',
  PAY_WINDOW_TOO_SHORT: 'error.booking.pay-window-too-short',
  AMOUNT_TOO_SMALL: 'error.booking.amount-too-small',
  PAYMENTS_OFF: 'payments.off',
  PROVIDER_NOT_READY: 'payments.providerNotReady',
  PAYOUT_SETUP_FIRST: 'payments.payoutSetupFirst',
  ALREADY_BOOKABLE: 'payments.alreadyBookable',
  // Invoices (`error`)
  NOT_READY: 'error.invoiceNotReady',
  BAD_YEAR: 'error.badYear',
  // Endings and reviews (`error`); the staff-only codes (DECISION_PENDING, SETTLEMENT_STARTED ...) never reach the app
  TOO_EARLY: 'error.booking.too-early',
  INVALID_MATERIAL_AMOUNT: 'error.booking.invalid-material-amount',
  NO_SHOW_REPORTED: 'error.booking.no-show-reported',
  STARTED: 'error.booking.started',
  OBJECTION_CLOSED: 'error.booking.objection-closed',
  DISPUTE_CLOSED: 'error.booking.dispute-closed',
  DISPUTE_EXISTS: 'error.booking.dispute-exists',
  NOT_STARTED: 'error.booking.not-started',
  ALREADY_STATED: 'error.booking.already-stated',
  INVALID_STOP_AMOUNT: 'error.booking.invalid-stop-amount',
  'time-required': 'error.booking.time-required',
  REVIEW_EXISTS: 'error.review.exists',
  REVIEW_CLOSED: 'error.review.closed',
  REVIEW_FINAL: 'error.review.final',
  // Chat (`error`)
  CONTACT_DETAILS: 'chat.contactBlocked',
  BLOCKED: 'chat.blocked',
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

/** Maps a required-document code to its name; unknown codes show the raw code. */
export const docText = (code: string): string => {
  const key = `doc.${code}`
  return known(key) ? t(key) : code
}
