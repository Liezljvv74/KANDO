import { photoSrc, searchPath } from '@/api/providers'
import { setLang } from '@/i18n'
import { formatAmount, formatDistance, formatPrice, ratingBadge } from './format'

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
}))
jest.mock('@/api/client', () => ({ api: jest.fn(), API_URL: 'https://x.test' }))

test('prices follow the website rules in German and English', () => {
  setLang('de')
  expect(formatPrice({ priceType: 'fixed', price: 20, currency: 'EUR' })).toMatch(/^20,00\s€$/)
  expect(formatPrice({ priceType: 'from', price: 20, currency: 'EUR' })).toMatch(/^ab 20,00\s€$/)
  expect(formatPrice({ priceType: 'hourly', price: 35.5, currency: 'EUR' })).toMatch(/^35,50\s€\/Std\.$/)
  expect(formatPrice({ priceType: 'on-request', price: null, currency: 'EUR' })).toBe('Preis auf Anfrage')
  expect(formatPrice({ priceType: 'fixed', price: 80, currency: 'ZAR' })).toMatch(/^80,00\s(ZAR|R)$/) // another currency formats with its own code, not the euro
  expect(formatPrice({ priceType: 'fixed', price: 80, currency: 'ZAR' })).not.toContain('€')
  expect(formatPrice({ priceType: 'fixed', price: null, currency: 'EUR' })).toBe('Preis auf Anfrage')
  setLang('en')
  expect(formatPrice({ priceType: 'from', price: 20, currency: 'EUR' })).toBe('from €20.00')
  expect(formatPrice({ priceType: 'hourly', price: 20, currency: 'EUR' })).toBe('€20.00/hr')
  expect(formatPrice({ priceType: 'on-request', price: null, currency: 'EUR' })).toBe('Price on request')
})

test('formatAmount gives the same text as the old fixed-price label', () => {
  for (const lang of ['de', 'en'] as const) {
    setLang(lang)
    for (const [amount, currency] of [[20, 'EUR'], [35.5, 'EUR'], [0, 'EUR'], [1234.56, 'EUR'], [12.5, 'ZAR']] as const) {
      expect(formatAmount(amount, currency)).toBe(formatPrice({ priceType: 'fixed', price: amount, currency }))
    }
  }
  setLang('de')
  expect(formatAmount(20, 'EUR')).toMatch(/^20,00\s€$/)
  setLang('en')
  expect(formatAmount(35.5, 'EUR')).toBe('€35.50')
})

test('distance shows km, remote or nothing', () => {
  expect(formatDistance({ distanceKm: 12, worksRemotely: false })).toBe('≈ 12 km')
  expect(formatDistance({ distanceKm: null, worksRemotely: true })).toBe('remote')
  expect(formatDistance({ distanceKm: null, worksRemotely: false })).toBeNull()
})

test('the badge shows the rating once rated, else New', () => {
  setLang('de')
  expect(ratingBadge({ average: 4.5, count: 2 })).toBe('4,5 ★ (2)')
  expect(ratingBadge(null)).toBe('Neu')
  setLang('en')
  expect(ratingBadge({ average: 4.5, count: 2 })).toBe('4.5 ★ (2)')
  expect(ratingBadge(undefined)).toBe('New') // an older cached response has no rating
})

test('search path leaves out empty filters and trims text', () => {
  expect(searchPath({})).toBe('/app-api/v1/providers?page=1')
  expect(searchPath({ category: 'plumbing', postcode: ' 10115 ', q: '  Rohr ', page: 2 })).toBe(
    '/app-api/v1/providers?category=plumbing&postcode=10115&q=Rohr&page=2',
  )
  expect(searchPath({ category: null, postcode: '', q: ' ' })).toBe('/app-api/v1/providers?page=1')
})

test('photoSrc loads only absolute http(s) URLs, never a server-relative /api path', () => {
  expect(photoSrc('https://cdn.test/a.jpg')).toBe('https://cdn.test/a.jpg')
  expect(photoSrc('http://cdn.test/a.jpg')).toBe('http://cdn.test/a.jpg')
  expect(photoSrc('/api/media/file/a.jpg')).toBeNull()
  expect(photoSrc('javascript:alert(1)')).toBeNull()
  expect(photoSrc(null)).toBeNull()
})
