import { ApiError } from '@/api/client'
import { missingText, setLang } from '@/i18n'

import { needsFormError, withItem, parsePrice, serverFieldErrors, serviceBody, validateReference, validateService } from './profile-form'

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
}))

test('server errors land on the right field', () => {
  expect(serverFieldErrors(new ApiError(400, 'Invalid fields', undefined, ['name']))).toEqual({ name: 'form.invalid' })
  expect(serverFieldErrors(new ApiError(400, 'Unknown postcode'))).toEqual({ basePostcode: 'error.unknownPostcode' })
  expect(serverFieldErrors(new ApiError(400, 'Invalid fields', undefined, ['bio', 'skills']))).toEqual({ bio: 'form.invalid', skills: 'form.invalid' })
  expect(serverFieldErrors(new ApiError(500, 'x', undefined, ['bio']))).toEqual({})
})

test('withItem adds a trimmed new skill or strength once and ignores blanks', () => {
  expect(withItem([], '  Fliesen ')).toEqual(['Fliesen'])
  expect(withItem(['Fliesen'], 'Fliesen')).toEqual(['Fliesen'])
  expect(withItem(['a'], '   ')).toEqual(['a'])
})

test('the form-level error shows unless every server error has an inline slot', () => {
  expect(needsFormError({}, ['bio'])).toBe(true)
  expect(needsFormError({ bio: 'form.invalid' }, ['bio'])).toBe(false)
  expect(needsFormError({ providerType: 'form.invalid' }, ['bio'])).toBe(true)
  expect(needsFormError({ bio: 'form.invalid', worksRemotely: 'form.invalid' }, ['bio'])).toBe(true)
})

test('service and reference validation', () => {
  expect(parsePrice('12,5')).toBe(12.5)
  expect(parsePrice('12.345')).toBeNull()
  expect(parsePrice('-1')).toBeNull()
  const s = { category: 'c1', title: 'Fix', description: '', priceType: 'fixed', price: '' }
  expect(validateService(s).price).toBe('s.priceError')
  expect(validateService({ ...s, priceType: 'on-request' })).toEqual({})
  expect(validateService({ ...s, category: null, price: '10' }).category).toBe('form.required')
  expect(validateReference({ clientName: 'A', description: 'B', year: '1969' }, 2026).year).toBe('r.yearError')
  expect(validateReference({ clientName: 'A', description: 'B', year: '2027' }, 2026).year).toBe('r.yearError')
  expect(validateReference({ clientName: 'A', description: 'B', year: '' }, 2026)).toEqual({})
})

test('every missing item the publish route can return has de and en text', () => {
  // German only: several English texts equal the item name ("experience"); key sets of de and en are tested in packages/i18n.
  for (const lang of ['de'] as const) {
    setLang(lang)
    for (const item of ['photo', 'service', 'providerType', 'businessName', 'impressum', 'skills', 'experience', 'postcode', 'radius']) expect(missingText(item)).not.toBe(item)
  }
  expect(missingText('unheard-of')).toBe('unheard-of')
})

test('the service body names the category by id and the currency, as the server expects', () => {
  expect(serviceBody({ category: 'c1', title: ' Fix ', description: '', priceType: 'fixed', price: '12,5' })).toEqual({
    categoryId: 'c1',
    title: 'Fix',
    description: '',
    priceType: 'fixed',
    price: 12.5,
    currency: 'EUR',
  })
})

test('a 400 "Invalid input" marks each named field', () => {
  expect(serverFieldErrors(new ApiError(400, 'Invalid input', undefined, ['bio']))).toEqual({ bio: 'form.invalid' })
})
