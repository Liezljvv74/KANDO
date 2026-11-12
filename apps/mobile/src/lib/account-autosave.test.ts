import { ApiError } from '@/api/client'
import { accountEntryBody, refusedField, shouldAutosave, unchangedSinceSave } from './account-autosave'

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

test('the entry body is what updateMe gets: trimmed names, the address, an ISO birth date', () => {
  const address = { postcode: '10115', country: 'DE' }
  expect(accountEntryBody({ firstName: ' Anna ', lastName: 'Berg ', address, birthDate: new Date(2000, 0, 5) })).toEqual({ firstName: 'Anna', lastName: 'Berg', address, birthDate: '2000-01-05' })
  expect(accountEntryBody({ firstName: 'A', lastName: 'B', address: null, birthDate: null })).toEqual({ firstName: 'A', lastName: 'B', address: null, birthDate: null })
})
test('the refused field comes from the error', () => {
  expect(refusedField(new ApiError(400, 'Invalid postcode'))).toBe('postcode')
  expect(refusedField(new ApiError(400, 'Invalid input', undefined, ['birthDate']))).toBe('birthDate')
  expect(refusedField(new ApiError(400, 'Invalid input', undefined, ['birthDate.x']))).toBe('birthDate')
  expect(refusedField(new ApiError(400, 'Invalid input', undefined, ['firstName']))).toBe('details')
  expect(refusedField(new ApiError(500, 'Server error'))).toBe('details')
})
test('equal values are skipped only when no kept entry exists', () => {
  expect(unchangedSinceSave('x', 'x', false)).toBe(true)
  expect(unchangedSinceSave('x', 'x', true)).toBe(false)
  expect(unchangedSinceSave('y', 'x', false)).toBe(false)
})
