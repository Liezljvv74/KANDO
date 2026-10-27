import { photoSrc, searchPath } from '@/api/providers'
import { setLang } from '@/i18n'
import { formatDistance, formatPrice } from './format'

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
  expect(formatPrice({ priceType: 'fixed', price: null, currency: 'EUR' })).toBe('Preis auf Anfrage')
  setLang('en')
  expect(formatPrice({ priceType: 'from', price: 20, currency: 'EUR' })).toBe('from €20.00')
  expect(formatPrice({ priceType: 'hourly', price: 20, currency: 'EUR' })).toBe('€20.00/hr')
  expect(formatPrice({ priceType: 'on-request', price: null, currency: 'EUR' })).toBe('Price on request')
})

test('distance shows km, remote or nothing', () => {
  expect(formatDistance({ distanceKm: 12, worksRemotely: false })).toBe('≈ 12 km')
  expect(formatDistance({ distanceKm: null, worksRemotely: true })).toBe('remote')
  expect(formatDistance({ distanceKm: null, worksRemotely: false })).toBeNull()
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
