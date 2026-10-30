import { api } from '@/api/client'
import { editReview, myReviews, writeReview } from './reviews'

jest.mock('@/api/client', () => ({ api: jest.fn() }))

beforeEach(() => (api as jest.Mock).mockReset().mockResolvedValue({ docs: [] }))
const last = () => (api as jest.Mock).mock.calls.at(-1)

test('reviews use their routes, methods and bodies', async () => {
  await writeReview('b1', { stars: 5, text: 'Great' })
  expect(last()).toEqual(['/app-api/v1/reviews', { method: 'POST', body: { bookingId: 'b1', stars: 5, text: 'Great' } }])
  await editReview('r 1', { stars: 4 })
  expect(last()).toEqual(['/app-api/v1/reviews/r%201', { method: 'PATCH', body: { stars: 4 } }])
  const docs = [{ id: 'r1' }]
  ;(api as jest.Mock).mockResolvedValueOnce({ docs })
  expect(await myReviews()).toEqual(docs)
  expect(last()).toEqual(['/app-api/v1/reviews'])
})
