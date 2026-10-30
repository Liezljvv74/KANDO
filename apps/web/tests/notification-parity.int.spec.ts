import { expect, it } from 'vitest'
import { pool } from '@kando/db'
import { NOTIFICATION_KINDS } from '@kando/contract'
import { EMAIL_KEYS } from '@kando/domain'
import { de, en } from '@kando/i18n'

const LANGS = { de, en } as Record<string, Record<string, string>>
const camel = (kind: string) => kind.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())

it('the contract kinds are exactly the database check list', async () => {
  const def = (await pool.query("SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname = 'notifications_kind_check'")).rows[0].d as string
  expect([...def.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]).sort()).toEqual([...NOTIFICATION_KINDS].sort())
})

it('every kind has an in-app text, a push title and body, and an email template, in German and English', () => {
  const missing: string[] = []
  for (const kind of NOTIFICATION_KINDS) {
    const email = (EMAIL_KEYS as Record<string, string>)[kind]
    if (!email) missing.push(`email template ${kind}`)
    for (const [lang, texts] of Object.entries(LANGS)) {
      for (const key of [`notification.${camel(kind)}`, `push.${kind}.title`, `push.${kind}.body`, ...(email ? [`${email}.subject`, `${email}.body`] : [])]) {
        if (!texts[key]?.trim()) missing.push(`${lang} ${key}`)
      }
    }
  }
  expect(missing).toEqual([])
})

it('every email template has a subject and a body in both languages', () => {
  const missing = Object.values(EMAIL_KEYS).flatMap((key) => Object.entries(LANGS).flatMap(([lang, texts]) => [`${key}.subject`, `${key}.body`].filter((k) => !texts[k]?.trim()).map((k) => `${lang} ${k}`)))
  expect(missing).toEqual([])
})

it('push texts carry no placeholders (no chat text, amounts or contact data) and no forbidden words', () => {
  for (const [lang, texts] of Object.entries(LANGS)) {
    for (const [key, text] of Object.entries(texts)) {
      if (!key.startsWith('push.')) continue
      expect(text, `${lang} ${key}`).not.toMatch(/[{}€@]|\d/)
      expect(text.toLowerCase(), `${lang} ${key}`).not.toMatch(/treuhand|escrow|garantie|guarantee/)
    }
    // German texts use the du-form
    if (lang === 'de') for (const [key, text] of Object.entries(texts)) if (key.startsWith('push.')) expect(text, key).not.toMatch(/\b(Sie|Ihre?[nmrs]?)\b/)
  }
})
