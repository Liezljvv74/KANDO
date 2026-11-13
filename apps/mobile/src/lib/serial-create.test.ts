jest.mock('@/lib/pending-saves', () => ({}))

import { categoryEntry } from './serial-create'

test('a category change of an existing service is a service-field entry the sender sends as an update', () => {
  expect(categoryEntry('s1', 'u1', 'c9')).toEqual({ key: 'service:s1:category', kind: 'service-field', accountId: 'u1', body: { categoryId: 'c9' }, serviceRef: 's1', route: '/my-profile/service/s1', field: 'category' })
})
