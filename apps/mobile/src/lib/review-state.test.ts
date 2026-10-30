import type { Review } from '@kando/contract'

import { reviewView } from './review-state'

const now = new Date('2027-01-10T10:00:00.000Z')
const r = (over: Partial<Review>): Review => ({
  id: 'r1',
  bookingId: 'b1',
  mine: true,
  authorRole: 'customer',
  stars: 4,
  text: null,
  createdAt: '2027-01-09T10:00:00.000Z',
  visibleAt: '2027-01-15T10:00:00.000Z',
  editableUntil: '2027-01-15T10:00:00.000Z',
  hidden: false,
  ...over,
})

test('nothing written yet: the form shows, the other side is not shown', () => {
  expect(reviewView([], 'b1', now)).toEqual({ mine: null, theirs: null, canWrite: true, canEdit: false })
})

test('my review is editable until editableUntil, then final; other bookings are ignored', () => {
  const mine = r({})
  expect(reviewView([mine, r({ id: 'x', bookingId: 'b2' })], 'b1', now)).toEqual({ mine, theirs: null, canWrite: false, canEdit: true })
  expect(reviewView([mine], 'b1', new Date('2027-01-15T10:00:00.000Z')).canEdit).toBe(false)
  expect(reviewView([r({ editableUntil: null })], 'b1', now).canEdit).toBe(false)
  expect(reviewView([r({ hidden: true })], 'b1', now).canEdit).toBe(false)
})

test('the other side\'s review stays hidden until it is visible (blind), even if the server sent it early', () => {
  const theirs = r({ id: 'r2', mine: false, authorRole: 'provider', editableUntil: null })
  expect(reviewView([theirs], 'b1', now).theirs).toBeNull()
  expect(reviewView([{ ...theirs, visibleAt: null }], 'b1', now).theirs).toBeNull()
  expect(reviewView([{ ...theirs, hidden: true, visibleAt: '2027-01-01T00:00:00.000Z' }], 'b1', now).theirs).toBeNull()
  const shown = { ...theirs, visibleAt: '2027-01-10T10:00:00.000Z' }
  expect(reviewView([shown], 'b1', now).theirs).toBe(shown)
})
