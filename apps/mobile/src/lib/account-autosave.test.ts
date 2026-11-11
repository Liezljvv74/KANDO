import { shouldAutosave } from './account-autosave'

const ok = { firstName: 'Anna', lastName: 'Berg', address: { street: '', postcode: '10115', city: '' }, birthDate: null }

test('valid values are saved', () => expect(shouldAutosave(ok)).toBe(true))
test('an empty address is fine', () => expect(shouldAutosave({ ...ok, address: { street: '', postcode: '', city: '' } })).toBe(true))
test('an empty required name is not saved', () => {
  expect(shouldAutosave({ ...ok, firstName: ' ' })).toBe(false)
  expect(shouldAutosave({ ...ok, lastName: '' })).toBe(false)
})
test('a street without a postcode is not saved', () => expect(shouldAutosave({ ...ok, address: { street: 'Main 1', postcode: '', city: '' } })).toBe(false))
test('a half-typed postcode is not saved', () => {
  expect(shouldAutosave({ ...ok, address: { ...ok.address, postcode: '1' } })).toBe(false)
  expect(shouldAutosave({ ...ok, address: { ...ok.address, postcode: '10 115 !' } })).toBe(false)
})
test('a birth date today or later is not saved', () => expect(shouldAutosave({ ...ok, birthDate: new Date(Date.now() + 86400000) })).toBe(false))
