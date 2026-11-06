import { setLang, t } from '@/i18n'
import { allSet, checklistHeading, checklistItems } from './live-checklist'

test('every missing item becomes a row with a label and a screen to open, in the server order', () => {
  expect(checklistItems(['service', 'strengths', 'name']).map((r) => [r.item, r.path])).toEqual([
    ['service', '/my-profile/service/new'],
    ['strengths', '/my-profile/about'],
    ['name', '/account'],
  ])
})

test('an item this app does not know (a newer server) is skipped', () => {
  expect(checklistItems(['skills', 'future' as never]).map((r) => r.item)).toEqual(['skills'])
})

test('each row label and the heading exist in German and English', () => {
  for (const lang of ['de', 'en'] as const) {
    setLang(lang)
    for (const r of checklistItems(['name', 'service', 'providerType', 'businessName', 'impressum', 'strengths', 'skills', 'postcode', 'radius'])) expect(t(r.label)).not.toBe(r.label)
    expect(t(checklistHeading(1), { n: 1 })).not.toContain('{n}')
    expect(t(checklistHeading(3), { n: 3 })).toContain('3')
    expect(t('setup.allSet')).not.toBe('setup.allSet')
  }
})

test('the heading is singular for one thing', () => {
  expect(checklistHeading(1)).toBe('setup.checklistOne')
  expect(checklistHeading(2)).toBe('setup.checklistMany')
})

test('all set only when nothing is missing and no quote step remains', () => {
  expect(allSet([], [])).toBe(true)
  expect(allSet([], undefined)).toBe(true)
  expect(allSet(['skills'], [])).toBe(false)
  expect(allSet([], ['consent'])).toBe(false)
})
