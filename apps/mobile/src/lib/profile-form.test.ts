import { ApiError } from '@/api/client'
import { missingText, setLang } from '@/i18n'

import { emptyProfile, nameChange, needsFormError, profileFromDoc, withItem, parsePrice, profileBody, serverFieldErrors, serviceBody, validateProfile, validateReference, validateService } from './profile-form'

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
}))

const ok = { ...emptyProfile, name: 'Anna Berg', displayName: 'Hochzeitsfotografie in Berlin' }

test('profile validation mirrors the server limits', () => {
  expect(validateProfile(ok)).toEqual({})
  expect(validateProfile(emptyProfile).displayName).toBe('form.required')
  expect(validateProfile(emptyProfile).name).toBe('form.required')
  expect(validateProfile({ ...ok, name: '   ' }).name).toBe('form.required')
  expect(validateProfile({ ...ok, name: 'x'.repeat(101) }).name).toBe('form.tooLong')
  expect(validateProfile({ ...ok, name: ` ${'x'.repeat(100)} ` })).toEqual({})
  expect(validateProfile({ ...ok, providerType: 'business' }).businessName).toBe('form.required')
  expect(validateProfile({ ...ok, basePostcode: '1234' }).basePostcode).toBe('search.postcodeInvalid')
  expect(validateProfile({ ...ok, experience: 'x'.repeat(501) }).experience).toBe('form.tooLong')
  expect(validateProfile({ ...ok, experience: `Seit 2010 Fotografin ${' '.repeat(600)}` })).toEqual({})
  expect(validateProfile({ ...ok, serviceRadiusKm: '0' }).serviceRadiusKm).toBe('f.radiusError')
  expect(validateProfile({ ...ok, serviceRadiusKm: '201' }).serviceRadiusKm).toBe('f.radiusError')
  expect(validateProfile({ ...ok, skills: Array(21).fill('x') }).skills).toBe('f.skillsError')
  expect(validateProfile({ ...ok, skills: ['x'.repeat(51)] }).skills).toBe('f.skillsError')
  expect(validateProfile({ ...ok, bio: 'x'.repeat(2001) }).bio).toBe('form.tooLong')
})

test('profile body clears empty fields and drops business fields for private providers', () => {
  const b = profileBody({ ...ok, businessName: 'Old GmbH', impressum: 'old', experience: '  5 Jahre Studio  ' })
  expect(b).toMatchObject({ businessName: '', impressum: '', experience: '5 Jahre Studio', basePostcode: '', serviceRadiusKm: 25 })
  expect(b).not.toHaveProperty('experienceYears')
  expect(profileBody({ ...ok, experience: '   ' }).experience).toBe('')
  expect(profileFromDoc({ experience: 'Seit 2010' }).experience).toBe('Seit 2010')
  expect(profileFromDoc({ experience: null }).experience).toBe('')
})

test('the account name is not part of the profile body; the form pre-fills it from the session user', () => {
  expect(profileBody(ok)).not.toHaveProperty('name')
  expect(profileFromDoc(null, 'Anna Berg').name).toBe('Anna Berg')
  expect(profileFromDoc({ displayName: 'Fotos' }, 'Anna Berg')).toMatchObject({ name: 'Anna Berg', displayName: 'Fotos' })
  expect(nameChange({ ...ok, name: ' Anna Berg ' }, 'Anna Berg')).toBeNull()
  expect(nameChange({ ...ok, name: ' Anna  Lena Berg ' }, 'Anna Berg')).toBe('Anna  Lena Berg')
})

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

test('strengths are a list in the form and one per line on the server', () => {
  const f = profileFromDoc({ displayName: 'x', strengths: 'Patient\n\n  Punctual \n' } as never, 'Name')
  expect(f.strengths).toEqual(['Patient', 'Punctual'])
  expect(profileFromDoc({ displayName: 'x', strengths: 'Patient\nPatient' } as never, 'N').strengths).toEqual(['Patient'])
  expect(profileBody({ ...f, strengths: ['Patient', 'Calm'] }).strengths).toBe('Patient\nCalm')
  expect(validateProfile({ ...ok, strengths: Array(21).fill('x') }).strengths).toBe('f.strengthsError')
  expect(validateProfile({ ...ok, strengths: ['x'.repeat(51)] }).strengths).toBe('f.strengthsError')
  expect(validateProfile({ ...ok, strengths: ['Patient'] }).strengths).toBeUndefined()
  // 20 × 50 characters plus 19 line breaks is 1019, over the server's 1000.
  expect(validateProfile({ ...ok, strengths: Array.from({ length: 20 }, (_, i) => `${i}`.padEnd(50, 'x')) }).strengths).toBe('form.tooLong')
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
  for (const lang of ['de', 'en'] as const) {
    setLang(lang)
    for (const item of ['displayName', 'impressum', 'photo', 'service', 'location']) expect(missingText(item)).not.toBe(item)
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
