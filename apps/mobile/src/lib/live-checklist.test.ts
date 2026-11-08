import { setLang, t } from '@/i18n'
import { allSet, checklistHeading, checklistItems, openItems } from './live-checklist'

test('every missing item becomes a row with a label and a screen to open, in the server order', () => {
  expect(checklistItems({ missing: ['service', 'strengths', 'name'] }).map((r) => [r.item, r.path])).toEqual([
    ['service', '/my-profile/service/new'],
    ['strengths', '/my-profile/about?field=strengths'],
    ['name', '/account'],
  ])
})

test('each About-you row opens its own field', () => {
  expect(checklistItems({ missing: ['businessName', 'radius'] }).map((r) => r.path)).toEqual(['/my-profile/about?field=businessName', '/my-profile/about?field=radius'])
})

test('all set counts the rows shown: an unknown missing item or step is not a row (as the gate counts)', () => {
  expect(allSet({ missing: ['future' as never] }, ['future' as never])).toBe(true)
})

test('an item this app does not know (a newer server) is skipped', () => {
  expect(checklistItems({ missing: ['skills', 'future' as never] }).map((r) => r.item)).toEqual(['skills'])
})

test('each row label and the heading exist in German and English', () => {
  for (const lang of ['de', 'en'] as const) {
    setLang(lang)
    for (const r of checklistItems({ missing: ['name', 'service', 'providerType', 'businessName', 'impressum', 'strengths', 'skills', 'postcode', 'radius'], underCheck: ['id-document'] })) expect(t(r.label)).not.toBe(r.label)
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
  expect(allSet({ missing: [] }, [])).toBe(true)
  expect(allSet({ missing: [] }, undefined)).toBe(false) // an old server sends no steps: unknown is not all set
  expect(allSet({ missing: [] }, ['future' as never])).toBe(true) // an unknown step is not a row
  expect(allSet({ missing: ['skills'] }, [])).toBe(false)
  expect(allSet({ missing: [] }, ['consent'])).toBe(false)
})

test('an item under our check is a checking row, listed after the open rows, with no screen to open', () => {
  const rows = checklistItems({ missing: ['skills'], underCheck: ['id-document'] })
  expect(rows.map((r) => [r.item, r.state])).toEqual([['skills', 'open'], ['id-document', 'checking']])
  expect(rows[1]).toMatchObject({ label: 'doc.short.id-document' })
  expect(rows[1]!.path).toBeUndefined()
})

test('an item under check is not counted as open and does not block all set', () => {
  const rows = checklistItems({ missing: [], underCheck: ['id-document'] })
  expect(openItems(rows)).toHaveLength(0)
  expect(allSet({ missing: [], underCheck: ['id-document'] }, [])).toBe(true)
  expect(allSet({ missing: ['skills'], underCheck: ['id-document'] }, [])).toBe(false)
})

test('an old server without underCheck behaves as before; an unknown requirement is skipped', () => {
  expect(checklistItems({ missing: ['name'] }).map((r) => r.state)).toEqual(['open'])
  expect(checklistItems({ missing: [], underCheck: ['future-doc'] })).toEqual([])
})

test('a rejected required document is a "needs action" row that opens it, and the list is not all set', () => {
  const docs = [
    { requirement: 'id-document', optional: false, state: 'rejected' as const },
    { requirement: 'trade-registration', optional: true, state: 'rejected' as const }, // optional: not a row
    { requirement: 'future-doc', optional: false, state: 'rejected' as const }, // unknown to this app: skipped
  ]
  const rows = checklistItems({ missing: ['skills'] }, docs)
  expect(rows.map((r) => [r.item, r.state, r.path])).toEqual([['skills', 'open', '/my-profile/about?field=skills'], ['id-document', 'rejected', '/my-profile/document/id-document']])
  expect(openItems(rows)).toHaveLength(1) // the Live count stays the server's missing list
  expect(allSet({ missing: [] }, [], docs)).toBe(false)
  expect(allSet({ missing: [] }, [], [{ requirement: 'id-document', optional: false, state: 'approved' }])).toBe(true)
  for (const lang of ['de', 'en'] as const) {
    setLang(lang)
    expect(t('setup.docRejected')).not.toBe('setup.docRejected')
    expect(t(rows[1]!.label)).not.toBe(rows[1]!.label)
  }
})
