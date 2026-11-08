import { api } from '@/api/client'
import { getJobs } from './jobs'

jest.mock('@/api/client', () => ({ api: jest.fn() }))

beforeEach(() => (api as jest.Mock).mockReset().mockResolvedValue({ items: [{ id: 'j1' }], next: 'c|1', counts: { needsYou: 1, unread: 0 } }))
const last = () => (api as jest.Mock).mock.calls.at(-1)

test('api/jobs sends role section and cursor', async () => {
  const page = await getJobs('provider', { section: 'past', cursor: '2027-01-05T09:00:00.000000Z|0b0f6c1e-0000-4000-8000-000000000001' })
  expect(last()).toEqual(['/app-api/v1/jobs?role=provider&section=past&cursor=2027-01-05T09%3A00%3A00.000000Z%7C0b0f6c1e-0000-4000-8000-000000000001'])
  expect(page).toEqual({ docs: [{ id: 'j1' }], next: 'c|1', counts: { needsYou: 1, unread: 0 } })
  await getJobs('customer', { q: 'Müller #10' })
  expect(last()).toEqual(['/app-api/v1/jobs?role=customer&q=M%C3%BCller%20%2310'])
  ;(api as jest.Mock).mockResolvedValueOnce({ items: [], counts: { needsYou: 0, unread: 0 } })
  expect((await getJobs('customer')).next).toBeNull()
  expect(last()).toEqual(['/app-api/v1/jobs?role=customer'])
})
