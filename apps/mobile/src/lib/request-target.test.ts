import type { ProviderDetail } from '@kando/contract'

import { requestTarget } from './request-target'

const service = (priceType: string, price: number | null) => ({ id: 's1', priceType, price }) as ProviderDetail['services'][number]
const provider = (over: Partial<ProviderDetail>) => ({ slug: 'anna', providerId: 'p1', worksRemotely: false, ...over }) as ProviderDetail

test('a fixed-price service is booked, others ask for a quote', () => {
  expect(requestTarget(provider({}), service('fixed', 50))).toEqual({ path: '/bookings/book', params: { slug: 'anna', serviceId: 's1' }, book: true })
  expect(requestTarget(provider({ worksRemotely: true }), service('fixed', 50))!.params.remote).toBe('1')
  expect(requestTarget(provider({}), service('hourly', 30))).toEqual({ path: '/bookings/new-request', params: { providerId: 'p1', serviceId: 's1' }, book: false })
  expect(requestTarget(provider({}))!.params).toEqual({ providerId: 'p1' })
})

test('a profile without providerId offers no request at all', () => {
  expect(requestTarget(provider({ providerId: undefined }), service('fixed', 50))).toBeNull()
  expect(requestTarget(provider({ providerId: null }))).toBeNull()
})
