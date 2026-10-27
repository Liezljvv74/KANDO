import { toAddress } from './address-fields'

jest.mock('@/i18n', () => ({ t: (k: string) => k }))

test('toAddress: empty is null (clears), complete is DE, partial is undefined', () => {
  expect(toAddress({ street: ' ', postcode: '', city: '' })).toBeNull()
  expect(toAddress({ street: 'Weg 1', postcode: '10115', city: 'Berlin' })).toEqual({ street: 'Weg 1', postcode: '10115', city: 'Berlin', country: 'DE' })
  expect(toAddress({ street: 'Weg 1', postcode: '', city: 'Berlin' })).toBeUndefined()
})
