import type { ProviderDetail } from '@kando/contract'

import { notifyOnly, requestTarget } from './request-target'

const service = (priceType: string, price: number | null) => ({ id: 's1', priceType, price }) as ProviderDetail['services'][number]
const provider = (over: Partial<ProviderDetail>) => ({ slug: 'anna', providerId: 'p1', worksRemotely: false, ...over }) as ProviderDetail

test('Book and Request a quote open the same request form; only the button word differs', () => {
  expect(requestTarget(provider({}), service('fixed', 50))).toEqual({ path: '/bookings/new-request', params: { providerId: 'p1', serviceId: 's1' }, book: true })
  expect(requestTarget(provider({ worksRemotely: true }), service('fixed', 50))!.params.remote).toBe('1')
  expect(requestTarget(provider({}), service('hourly', 30))).toEqual({ path: '/bookings/new-request', params: { providerId: 'p1', serviceId: 's1' }, book: false })
  expect(requestTarget(provider({}))!.params).toEqual({ providerId: 'p1' })
})

test('a quote request tells the form whether the provider works remotely', () => {
  expect(requestTarget(provider({ worksRemotely: true }), service('hourly', 30))!.params).toEqual({ providerId: 'p1', serviceId: 's1', remote: '1' })
  expect(requestTarget(provider({ worksRemotely: false }))!.params.remote).toBeUndefined()
})

test('a profile without providerId offers no request at all', () => {
  expect(requestTarget(provider({ providerId: undefined }), service('fixed', 50))).toBeNull()
  expect(requestTarget(provider({ providerId: null }))).toBeNull()
})

test('only an explicit canBook false turns Book into Notify me; an older profile without it keeps booking', () => {
  expect(notifyOnly(provider({ canBook: false }))).toBe(true)
  expect(notifyOnly(provider({ canBook: true }))).toBe(false)
  expect(notifyOnly(provider({ canBook: null }))).toBe(false)
  expect(notifyOnly(provider({ canBook: undefined }))).toBe(false)
})
