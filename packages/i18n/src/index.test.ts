import { describe, expect, it } from 'vitest'

import { de } from './de'
import { en } from './en'
import { DEFAULT_LANG, formatMoney, formatPrice, isLang, LANGS, acceptLang, t, type Key } from './index'

const FORBIDDEN = [
  'treuhand',
  'escrow',
  'garantiert',
  'taskrabbit',
  'mybuilder',
  'checkatrade',
  'helpling',
  'myhammer',
  'blauarbeit',
  'airtasker',
  'thumbtack',
  'fiverr',
  'upwork',
  'bark.com',
  'book a tiger',
  'ebay',
]

describe('catalogue', () => {
  it('de and en have the same keys', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(de).sort())
  })

  it('no text is empty and no two keys of one namespace carry the same text', () => {
    for (const texts of [de, en]) {
      const seen = new Map<string, string>() // namespace + text -> key
      for (const [key, text] of Object.entries(texts)) {
        expect(text.trim(), key).not.toBe('')
        const id = `${key.split('.')[0]}|${text}`
        expect(seen.get(id), `${key} repeats ${seen.get(id)}`).toBeUndefined()
        seen.set(id, key)
      }
    }
  })

  it('no text contains Treuhand, Escrow, garantiert or a competitor name', () => {
    for (const [key, text] of [...Object.entries(de), ...Object.entries(en)]) {
      for (const word of FORBIDDEN)
        expect(text.toLowerCase(), `${key}: ${word}`).not.toContain(word)
    }
  })

  it('the product name is only written in brand.name', () => {
    for (const [key, text] of [...Object.entries(de), ...Object.entries(en)]) {
      if (key === 'brand.name') continue
      expect(text, key).not.toMatch(/skillweb/i)
      expect(text, key).not.toMatch(/Skilled/)
    }
    expect(de['brand.name']).toBe('SkillWeb')
  })
})

describe('t', () => {
  it('replaces placeholders and falls back to the key when missing', () => {
    expect(t('de', 'myProfile.portfolioCount', { n: 2, max: 10 })).toBe('2 von 10')
    expect(t('en', 'myProfile.portfolioCount', { n: 2, max: 10 })).toBe('2 of 10')
    expect(t('en', 'nope.nothing' as Key)).toBe('nope.nothing')
  })

  it('fills the brand name without a parameter', () => {
    expect(t('en', 'email.verify.body', { code: '123456' })).toBe(
      'Welcome to SkillWeb! Your confirmation code is: 123456',
    )
  })

  it('knows its languages', () => {
    expect(LANGS).toEqual(['de', 'en'])
    expect(DEFAULT_LANG).toBe('de')
    expect(isLang('en')).toBe(true)
    expect(isLang('fr')).toBe(false)
  })
})

const plain = (s: string) => s.replace(/\u00a0/g, ' ')

describe('money', () => {
  it('formats per language', () => {
    expect(plain(formatMoney(80, 'EUR', 'de'))).toBe('80,00 €')
    expect(formatMoney(80, 'EUR', 'en')).toBe('€80.00')
  })

  it('formats price labels from the catalogue', () => {
    expect(plain(formatPrice('from', 20, 'EUR', 'de'))).toBe('ab 20,00 €')
    expect(plain(formatPrice('hourly', 35.5, 'EUR', 'de'))).toBe('35,50 €/Std.')
    expect(formatPrice('on-request', null, 'EUR', 'de')).toBe('Preis auf Anfrage')
    expect(formatPrice('from', 20, 'EUR', 'en')).toBe('from €20.00')
    expect(formatPrice('hourly', 20, 'EUR', 'en')).toBe('€20.00/hr')
    expect(formatPrice('on-request', null, 'EUR', 'en')).toBe('Price on request')
    expect(plain(formatPrice('fixed', 20, 'EUR', 'de'))).toBe('20,00 €')
  })
})

describe('acceptLang', () => {
  it.each([
    ['en-GB,en;q=0.9,de;q=0.8', 'en'],
    ['*', undefined],
    ['fr-FR', undefined],
    ['', undefined],
    [undefined, undefined],
  ] as const)('%s -> %s', (header, lang) => expect(acceptLang(header)).toBe(lang))
})
