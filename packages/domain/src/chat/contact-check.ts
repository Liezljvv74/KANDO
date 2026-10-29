import { CONTACT_LINK_TLDS } from './rules'

export type ContactHit = 'phone' | 'email' | 'link'

// All patterns below are linear-time on purpose: every match starts at a single
// character or behind a lookbehind (so a long run is never re-scanned from each
// position), and every repetition is bounded or has a delimiter the next token cannot
// contain. A 50,000 character message must stay in the millisecond range.

const TLD = `(?:${CONTACT_LINK_TLDS.join('|')})`
const LETTERS = 'a-zäöüß'

// "at" spelled out: "(at)", "[at]", "@" (also with spaces) or a bare " at "/" ät ".
const AT = String.raw`(?:\s*[(\[{]\s*(?:at|ät|@)\s*[)\]}]\s*|\s+(?:at|ät)\s+|\s*@\s*)`
// "dot" spelled out. Email only: also a bare "." or a spaced " . ".
const DOT_BRACKET = String.raw`\s*[(\[{]\s*(?:dot|punkt)\s*[)\]}]\s*`
const DOT_WORD = String.raw`\s+(?:dot|punkt)\s+`
const DOT_EMAIL = String.raw`(?:${DOT_BRACKET}|${DOT_WORD}|\s+\.\s+|\.)`
const LABEL = '[a-z0-9-]{1,63}'

// The bare "x at y" form needs a dot after the domain, so "we meet at home at 5" is fine.
// Dot "." directly joined (no spaces) so "at home. Then" is not read as a domain.
const EMAIL_PLAIN = /[a-z0-9._%+-]@[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63}){0,4}\.[a-z]{2,}/
const EMAIL_SPELLED = new RegExp(`[a-z0-9]${AT}${LABEL}(?:${DOT_EMAIL}${LABEL}){0,4}${DOT_EMAIL}[a-z]{2,}`)

const LINK_SCHEME = /https?:\/\/|www\s*\.[a-z0-9]/
const LINK_BARE = new RegExp(String.raw`[a-z0-9-]\.${TLD}(?![a-z0-9])`)
// Spelled dot only counts when a known tld word follows ("example dot com", not "a dot on the i").
const LINK_SPELLED = new RegExp(`[a-z0-9-](?:${DOT_BRACKET}|${DOT_WORD})${TLD}(?![a-z0-9])`)

// Dates, times and prices are removed before counting digits. Prices may not start with
// 0 (except "0,50"), so "€ 0151 2345678" is not treated as a price.
const ISO_DATE = /(?<!\d)(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])(?:-\d{1,4})?(?!-?\d)/g
const DATE = /(?<![\d.])(?:0?[1-9]|[12]\d|3[01])\.(?:0?[1-9]|1[0-2])\.(?:\d{4}|\d{2})(?!\d)/g
const TIME_COLON = /(?<!\d)(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?(?!\d)/g
const TIME_UHR = /(?<![\d.])(?:[01]?\d|2[0-3])\.[0-5]\d\s*uhr/g
const AMOUNT = String.raw`(?:0(?=,)|[1-9]\d{0,5})(?:\.\d{3})*(?:,\d+)?`
const PRICE_AFTER = new RegExp(String.raw`(?<![\d.,])${AMOUNT}\s*(?:€|euro?)(?![${LETTERS}])`, 'g')
const PRICE_BEFORE = new RegExp(String.raw`(?:€|(?<![${LETTERS}])euro?)\s*${AMOUNT}(?!\d)`, 'g')

const WORD_DIGITS: Record<string, string> = {
  null: '0', eins: '1', ein: '1', zwei: '2', zwo: '2', drei: '3', vier: '4',
  fünf: '5', fuenf: '5', sechs: '6', sieben: '7', acht: '8', neun: '9',
  zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9',
}
const WORD = String.raw`(?<![${LETTERS}])(?:${Object.keys(WORD_DIGITS).join('|')})(?![${LETTERS}])`
const NUM = String.raw`(?:\d+|${WORD})`
// 3 or more number tokens in a row (words or digits). A single "ein"/"one" never counts.
const NUMBER_RUN = new RegExp(String.raw`(?<![\d${LETTERS}])${NUM}(?:[ \t._\-/()]{1,3}${NUM}){2,}`, 'g')
const WORD_ONLY = new RegExp(WORD, 'g')
// Commas count as a separator only between two number words, never between digits ("1,5", "3, 4, 5").
const WORD_COMMA = new RegExp(String.raw`(${WORD})\s*,\s*(?=${WORD})`, 'g')
const PLUS_WORD = new RegExp(String.raw`(?<![${LETTERS}])plus\s*(?=\d)`, 'g')

// Digit groups joined by spaces . - / ( ) _ but never by a comma or a line break.
const DIGIT_RUN = /(?<!\d)(\+?)\d(?:[ .\-/()_]{0,3}\d)*/g

/**
 * Rules-based check for phone numbers, emails and links. Pure and total (never throws).
 * Order matters: email, link, then the digit rules on text with dates/times/prices removed.
 */
export function findContactDetails(text: string): ContactHit | null {
  const s = text
    .normalize('NFKC')
    .toLowerCase()
    // invisible characters, variation selector and keycap mark (keycap digits fold to digits)
    .replace(/[\u200b-\u200f\u2060\ufeff\u00ad]|\ufe0f|\u20e3/g, '')
    // en/em/figure dash and minus sign read as a hyphen
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    // pictographs between digits read as spaces
    .replace(/\p{Extended_Pictographic}/gu, ' ')

  if (EMAIL_PLAIN.test(s) || EMAIL_SPELLED.test(s)) return 'email'
  if (LINK_SCHEME.test(s) || LINK_BARE.test(s) || LINK_SPELLED.test(s)) return 'link'

  const t = s
    .replace(ISO_DATE, ' ')
    .replace(DATE, ' ')
    .replace(TIME_COLON, ' ')
    .replace(TIME_UHR, ' ')
    .replace(PRICE_AFTER, ' ')
    .replace(PRICE_BEFORE, ' ')
    .replace(WORD_COMMA, '$1 ')
    .replace(NUMBER_RUN, (run) => run.replace(WORD_ONLY, (w) => WORD_DIGITS[w] ?? w))
    .replace(PLUS_WORD, '+')

  for (const m of t.matchAll(DIGIT_RUN)) {
    const digits = m[0].replace(/\D/g, '')
    if (digits.length >= 10) return 'phone'
    if (digits.length >= 7 && (m[1] === '+' || digits.startsWith('0'))) return 'phone'
  }
  return null
}

export async function checkContactDetails(text: string): Promise<ContactHit | null> {
  const hit = findContactDetails(text)
  if (hit) return hit
  // EXTENSION POINT (not built): AI check of text that passed the rules, only after an EU provider and a data processing agreement exist (spec 9a). Must never send text anywhere until then.
  return null
}
