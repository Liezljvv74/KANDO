import { setLang } from '@/i18n'
import { aboutMissing, accountMissing, missingMessage, serviceMissing } from './required-fields'

const about = { providerType: 'individual', businessName: '', impressum: '', strengths: ['a'], skills: ['b'], postcode: '10115', radiusValid: true }

test('about: an individual is not asked for business name or legal notice', () => {
  expect(aboutMissing(about)).toEqual([])
})
test('about: a business is', () => {
  expect(aboutMissing({ ...about, providerType: 'business' })).toEqual(['f.businessName', 'provider.impressum'])
})
test('about: everything empty', () => {
  expect(aboutMissing({ ...about, providerType: null, strengths: [], skills: [], postcode: ' ', radiusValid: false })).toEqual(['f.type', 'provider.strengths', 'provider.skills', 'search.postcode', 'f.radius'])
})
test('service: on-request needs no price', () => {
  expect(serviceMissing({ category: 'cleaning', priceType: 'on-request', price: '' })).toEqual([])
})
test('service: fixed needs a price', () => {
  expect(serviceMissing({ category: 'cleaning', priceType: 'fixed', price: '' })).toEqual(['s.price'])
  expect(serviceMissing({ category: null, priceType: null, price: '' })).toEqual(['search.category', 's.priceType', 's.price'])
})
test('account: birth date only for a provider', () => {
  const a = { firstName: 'A', lastName: 'B', postcode: '10115', hasBirthDate: false }
  expect(accountMissing({ ...a, isProvider: false })).toEqual([])
  expect(accountMissing({ ...a, isProvider: true })).toEqual(['auth.birthDate'])
})
test('the message names the fields', () => {
  setLang('en')
  expect(missingMessage(['s.price'])).toContain('Price')
})
