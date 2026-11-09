import { COMMISSION_RATE, FREE_CANCEL_HOURS, HELP_GROUPS, HELP_OPENING_SLUG, LATE_CANCEL_SHARE, MAX_MESSAGE_CHARS, NO_SHOW_OBJECTION_HOURS, STOP_ANSWER_DAYS } from '@kando/contract'
import { expect, it } from 'vitest'

import { ID_IMAGE_KEEP_DAYS } from '../ai/document-check'
import { ASK_DONE_HOURS, CONFIRM_DAYS, DISPUTE_DECISION_WORKING_DAYS, NO_ACTION_STAFF_DAYS, REVIEW_EDIT_DAYS, REVIEW_VISIBLE_DAYS } from '../bookings/ending-rules'
import { AWAITING_TIME_DAYS, MAX_OPEN_REQUESTS_PER_PAIR, MAX_REQUESTS_PER_DAY, PAY_BEFORE_START_HOURS, PAY_WINDOW_HOURS, QUOTE_VALID_DAYS, REQUEST_ANSWER_DAYS, SHORT_NOTICE_PAY_HOURS, TIME_ANSWER_DAYS } from '../bookings/rules'
import { CHAT_EMAIL_THROTTLE_MINUTES } from '../chat/rules'
import { MAX_DOCUMENT_BYTES } from '../documents'
import { CUSTOMERS_WAITING_NOTICE_HOURS, MAX_PAY_AHEAD_DAYS } from '../payments/rules'
import { MAX_PORTFOLIO_PHOTOS } from '../photos'
import { MAX_PROVIDER_REFERENCES } from '../providers/items'
import { PAGE_SIZE } from '../search'
import { helpTopics } from './topics'

const topics = helpTopics()
const by = (slug: string) => topics.find((t) => t.slug === slug) ?? expect.fail(`no topic ${slug}`)
const both = (slug: string) => [by(slug).bodyDe, by(slug).bodyEn]

it('every topic has a title and a body in German and in English, a known group, and a unique slug and sort', () => {
  for (const t of topics) {
    for (const [field, v] of Object.entries({ titleDe: t.titleDe, bodyDe: t.bodyDe, titleEn: t.titleEn, bodyEn: t.bodyEn })) expect(v.trim().length, `${t.slug}.${field}`).toBeGreaterThan(5)
    expect(HELP_GROUPS, t.slug).toContain(t.group)
  }
  expect(new Set(topics.map((t) => t.slug)).size).toBe(topics.length)
  expect(new Set(topics.map((t) => t.sort)).size).toBe(topics.length)
})

it('a body has 2 to 6 sentences (short topics), and German and English have the same numbers', () => {
  const tooLong: string[] = []
  for (const t of topics) {
    for (const body of [t.bodyDe, t.bodyEn]) {
      const n = body.split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ"„])/).length
      if (n < 2 || n > 6) tooLong.push(`${t.slug}: ${n}`)
    }
    const nums = (s: string) => (s.match(/\d+/g) ?? []).sort().join(',')
    expect(nums(t.bodyDe), t.slug).toBe(nums(t.bodyEn))
  }
  expect(tooLong, 'topics outside 2 to 6 sentences').toEqual([])
})

it('the opening topic is the first, approved; the money and governance topics are written but hidden until approved', () => {
  const first = [...topics].sort((a, b) => a.sort - b.sort)[0]!
  expect(first.slug).toBe(HELP_OPENING_SLUG)
  expect(first.approved).toBe(true)
  expect(by('how-it-is-governed').approved).toBe(false)
  expect(by('where-the-money-is-kept').approved).toBe(false)
  expect(topics.filter((t) => !t.approved).map((t) => t.slug).sort()).toEqual(['how-it-is-governed', 'where-the-money-is-kept'])
})

it('key numbers in the texts are the numbers the code runs on', () => {
  const pct = (x: number) => String(Math.round(x * 100))
  const expected: [string, (string | number)[]][] = [
    ['what-is-kando', [pct(COMMISSION_RATE), CONFIRM_DAYS]],
    ['commission-and-fees', [pct(COMMISSION_RATE), pct(LATE_CANCEL_SHARE)]],
    ['cancelling', [FREE_CANCEL_HOURS, pct(LATE_CANCEL_SHARE)]],
    ['paying', [PAY_WINDOW_HOURS, PAY_BEFORE_START_HOURS, SHORT_NOTICE_PAY_HOURS, MAX_PAY_AHEAD_DAYS]],
    ['sending-a-request', [REQUEST_ANSWER_DAYS, MAX_OPEN_REQUESTS_PER_PAIR, MAX_REQUESTS_PER_DAY]],
    ['quotes', [QUOTE_VALID_DAYS, TIME_ANSWER_DAYS, AWAITING_TIME_DAYS]],
    ['finishing-a-job', [CONFIRM_DAYS, ASK_DONE_HOURS]],
    ['no-show', [NO_SHOW_OBJECTION_HOURS]],
    ['stopping-a-job', [STOP_ANSWER_DAYS]],
    ['reporting-a-problem', [CONFIRM_DAYS, DISPUTE_DECISION_WORKING_DAYS, NO_ACTION_STAFF_DAYS]],
    ['reviews', [REVIEW_VISIBLE_DAYS, REVIEW_EDIT_DAYS]],
    ['finding-providers', [PAGE_SIZE]],
    ['provider-setup', [MAX_PORTFOLIO_PHOTOS, MAX_PROVIDER_REFERENCES]],
    ['checked-and-verified', [ID_IMAGE_KEEP_DAYS]],
    ['payout-setup', [CUSTOMERS_WAITING_NOTICE_HOURS]],
    ['chat-and-contact-details', [MAX_MESSAGE_CHARS]],
    ['notifications', [CHAT_EMAIL_THROTTLE_MINUTES]],
  ]
  for (const [slug, numbers] of expected) for (const body of both(slug)) for (const n of numbers) expect(body, `${slug}: ${n}`).toMatch(new RegExp(`(^|[^\\d])${n}([^\\d]|$)`))
  expect(by('provider-setup').bodyEn).toContain(`${MAX_DOCUMENT_BYTES / 1_000_000} MB`)
  expect(by('provider-setup').bodyDe).toContain(`${String(MAX_DOCUMENT_BYTES / 1_000_000).replace('.', ',')} MB`)
})

it('no number with a time or money unit is typed by hand: each one is a code constant (or the 12-month window, a SQL rule)', () => {
  const allowed = new Set(
    [
      FREE_CANCEL_HOURS, NO_SHOW_OBJECTION_HOURS, STOP_ANSWER_DAYS, CONFIRM_DAYS, DISPUTE_DECISION_WORKING_DAYS, REVIEW_VISIBLE_DAYS, REVIEW_EDIT_DAYS,
      ASK_DONE_HOURS, NO_ACTION_STAFF_DAYS, QUOTE_VALID_DAYS, REQUEST_ANSWER_DAYS, TIME_ANSWER_DAYS, AWAITING_TIME_DAYS, PAY_WINDOW_HOURS,
      PAY_BEFORE_START_HOURS, SHORT_NOTICE_PAY_HOURS, MAX_PAY_AHEAD_DAYS, ID_IMAGE_KEEP_DAYS, CUSTOMERS_WAITING_NOTICE_HOURS, CHAT_EMAIL_THROTTLE_MINUTES,
      Math.round(COMMISSION_RATE * 100), Math.round(LATE_CANCEL_SHARE * 100), MAX_DOCUMENT_BYTES / 1_000_000,
      12, // provider_reliability and the provider no-show rule look back 12 months (packages/db/src/rls.ts, bookings/cancel.ts)
      6, // the default retention in months (retentionMonths)
      0.5,
    ].map((n) => String(n).replace('.', ',')),
  )
  const unit = /(\d+(?:[.,]\d+)?)\s*(hours?|days?|working days|minutes|percent|months?|MB|Stunden|Tage[n]?|Arbeitstagen|Minuten|Prozent|Monate[n]?)\b/g
  for (const t of topics)
    for (const body of [t.bodyDe, t.bodyEn])
      for (const m of body.matchAll(unit)) expect(allowed.has(m[1]!.replace('.', ',')), `${t.slug}: "${m[0]}"`).toBe(true)
})

it('says nothing the app cannot back up: no banned wording, no unverified promises, no live money', () => {
  const banned = [/treuhand/i, /escrow/i, /garantie/i, /guarantee/i, /frankfurt/i, /skillweb/i, /live payments?/i, /echtes geld (wird|wurde)? ?ausgezahlt/i, /will suspend/i, /wird gesperrt/i, /within 7 days of confirmation/i, /innerhalb von 7 tagen nach der bestätigung/i, /instant/i, /calendar of available/i]
  for (const t of topics) for (const text of [t.titleDe, t.bodyDe, t.titleEn, t.bodyEn]) for (const re of banned) expect(text, `${t.slug} ${re}`).not.toMatch(re)
  // wherever money is described the test mode is said
  for (const slug of ['what-is-kando', 'paying', 'where-the-money-is-kept', 'payout-setup']) {
    expect(by(slug).bodyEn.toLowerCase(), slug).toContain('test mode')
    expect(by(slug).bodyDe, slug).toContain('Testmodus')
  }
})
