import { expect, it } from 'vitest'

import { MeSchema } from './me'

const me = { id: 'u', email: 'a@b.c', firstName: null, lastName: null, isProvider: false, photoUrl: null, address: null }
const n = (id: string, kind: string, payload: object) => ({ id, kind, payload, createdAt: 'x', seenAt: null, dismissedAt: null })

it('an old kind and a new kind parse; an unknown kind is dropped without failing the rest', () => {
  const parsed = MeSchema.parse({
    ...me,
    notifications: [n('1', 'profile-live', { url: 'https://x.test/p' }), n('2', 'quote-received', { quoteId: 'q' }), n('3', 'kind-from-the-future', { whatever: 1 }), n('4', 'requests-ignored', {})],
  })
  expect(parsed.notifications.map((x) => x.id)).toEqual(['1', '2', '4'])
})
