import { MissingSchema } from '@kando/contract'
import { setLang, t } from '@/i18n'
import { COMPULSORY, compulsory } from './compulsory'

// `name` is the account's name, edited on the account screen, not on the profile page.
const ON_ACCOUNT_SCREEN = ['name']

test('every item the server can report as missing has a field with a star and a lead text', () => {
  for (const item of MissingSchema.options.filter((i) => !ON_ACCOUNT_SCREEN.includes(i))) expect(Object.values(COMPULSORY).some((f) => f.item === item)).toBe(true)
})

test('each compulsory field has a starred label and a lead text in German and English', () => {
  for (const lang of ['de', 'en'] as const) {
    setLang(lang)
    for (const [field, f] of Object.entries(COMPULSORY)) {
      const c = compulsory(field as keyof typeof COMPULSORY)
      expect(c.label).toBe(`${t(f.label)} *`)
      expect(t(f.label)).not.toBe(f.label) // a missing text comes back as its key
      expect(c.placeholder).not.toBe(f.placeholder)
    }
  }
})

test('the lead text of one language never repeats a label (the catalogue test needs distinct texts)', () => {
  setLang('en')
  expect(new Set(Object.keys(COMPULSORY).map((f) => compulsory(f as keyof typeof COMPULSORY).placeholder)).size).toBe(Object.keys(COMPULSORY).length)
})
