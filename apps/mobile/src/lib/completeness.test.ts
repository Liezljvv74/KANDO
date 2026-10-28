import type { OwnService } from '@kando/contract'
import { aboutComplete, documentsComplete, hasEntries, servicesComplete } from './completeness'
import type { DocumentRow } from './documents'

const row = (optional: boolean, state: DocumentRow['state']): DocumentRow => ({ requirement: 'permit', optional, state, note: null })

test('services are complete with at least one service that has a price type', () => {
  expect(servicesComplete([])).toBe(false)
  expect(servicesComplete([{ priceType: null }] as OwnService[])).toBe(false)
  expect(servicesComplete([{ priceType: null }, { priceType: 'fixed' }] as OwnService[])).toBe(true)
})

test('about you is complete when the server lists none of its fields as missing', () => {
  expect(aboutComplete([])).toBe(true)
  expect(aboutComplete(['name', 'service'])).toBe(true) // not About you items
  for (const item of ['providerType', 'businessName', 'impressum', 'strengths', 'skills', 'postcode', 'radius']) expect(aboutComplete(['service', item])).toBe(false)
})

test('documents: every compulsory one approved or pending; optional-only needs one sent', () => {
  expect(documentsComplete([row(false, 'approved'), row(false, 'pending'), row(true, 'none')])).toBe(true)
  expect(documentsComplete([row(false, 'approved'), row(false, 'none')])).toBe(false)
  expect(documentsComplete([row(false, 'rejected')])).toBe(false)
  expect(documentsComplete([row(true, 'none'), row(true, 'rejected')])).toBe(false)
  expect(documentsComplete([row(true, 'none'), row(true, 'pending')])).toBe(true)
})

test('past jobs and portfolio are green with an entry', () => {
  expect(hasEntries(0)).toBe(false)
  expect(hasEntries(1)).toBe(true)
})
