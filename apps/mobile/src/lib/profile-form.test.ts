import { ApiError } from '@/api/client'
import { missingText, setLang } from '@/i18n'

import { createFieldSaver } from '@/hooks/use-field-save'
import { isLive, needsFormError, radiusBody, typedTag, validRadius, withItem, parsePrice, serverFieldErrors, serviceBody, validateReference, validateService } from './profile-form'

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

test('typedTag keeps to the tag limits like TagInput and says when a limit stopped it', () => {
  expect(typedTag(['a'], ' b ', 3, 5, 100)).toEqual({ list: ['a', 'b'], tooLong: false })
  expect(typedTag(['a'], '   ', 3, 5, 100)).toEqual({ list: null, tooLong: false })
  expect(typedTag(['a', 'b', 'c'], 'd', 3, 5, 100)).toEqual({ list: null, tooLong: true }) // already at the maximum
  expect(typedTag(['a'], 'abcdef', 3, 5, 100)).toEqual({ list: null, tooLong: true }) // longer than one tag may be
  expect(typedTag(['aaaa'], 'bbbb', 3, 5, 8)).toEqual({ list: null, tooLong: true }) // joined text too long
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
    for (const item of ['name', 'service', 'providerType', 'businessName', 'impressum', 'skills', 'experience', 'postcode', 'radius']) expect(missingText(item)).not.toBe(item)
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

test('live means published and not suspended now (the server rule of listServices)', () => {
  const now = new Date('2026-10-27T12:00:00Z')
  expect(isLive({ status: 'published', suspendedUntil: null }, now)).toBe(true)
  expect(isLive({ status: 'published', suspendedUntil: '2026-10-27T11:00:00Z' }, now)).toBe(true)
  expect(isLive({ status: 'published', suspendedUntil: '2026-10-28T11:00:00Z' }, now)).toBe(false)
  expect(isLive({ status: 'draft', suspendedUntil: null }, now)).toBe(false)
})

test('an invalid radius keeps the typed value, is reported as invalid and sends nothing', async () => {
  const request = jest.fn(async (_: object) => {})
  const saver = createFieldSaver<string>(async (v) => {
    const body = radiusBody(v)
    if (body) await request(body) // as in the about card: no body, no request
  }, 600, () => {})
  saver.set('300')
  await saver.flush()
  expect(request).not.toHaveBeenCalled()
  expect(validRadius('300')).toBe(false) // the field shows its error; the typed text stays with the field (the saver never resets it)
  saver.set('30')
  await saver.flush()
  expect(request).toHaveBeenCalledWith({ serviceRadiusKm: 30 })
})
