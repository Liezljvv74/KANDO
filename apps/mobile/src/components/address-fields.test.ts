import { toAddress } from './address-fields'

jest.mock('@/i18n', () => ({ t: (k: string) => k }))

test('toAddress: empty is null (clears), a postcode alone is enough, street or city without postcode is undefined', () => {
  expect(toAddress({ street: ' ', postcode: '', city: '' })).toBeNull()
  expect(toAddress({ street: 'Weg 1', postcode: '10115', city: 'Berlin' })).toEqual({ street: 'Weg 1', postcode: '10115', city: 'Berlin', country: 'DE' })
  expect(toAddress({ street: '', postcode: ' 10115 ', city: '' })).toEqual({ postcode: '10115', country: 'DE' })
  expect(toAddress({ street: 'Weg 1', postcode: '', city: '' })).toBeUndefined()
  expect(toAddress({ street: '', postcode: '', city: 'Berlin' })).toBeUndefined()
  // the country already stored on the account is kept
  expect(toAddress({ street: 'Weg 1', postcode: '2000', city: 'Kapstadt' }, 'ZA')).toEqual({ street: 'Weg 1', postcode: '2000', city: 'Kapstadt', country: 'ZA' })
})
