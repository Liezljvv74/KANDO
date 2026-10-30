import { isHttps } from './safe-url'

test('only an https link may be opened', () => {
  expect(isHttps('https://checkout.stripe.com/x')).toBe(true)
  expect(isHttps('http://x.test')).toBe(false)
  expect(isHttps('javascript:alert(1)')).toBe(false)
  expect(isHttps('skilled://threads/1')).toBe(false)
  expect(isHttps(undefined)).toBe(false)
})
