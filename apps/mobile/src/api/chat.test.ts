import { api, upload } from '@/api/client'
import { blockUser, threadIdForBooking, threadIdForRequest, listBlocks, listMessages, listThreads, reportMessage, sendMessage, sendPhoto, unblockUser } from './chat'

jest.mock('@/api/client', () => ({ api: jest.fn(), upload: jest.fn() }))

beforeEach(() => {
  ;(api as jest.Mock).mockReset().mockResolvedValue({ docs: [] })
  ;(upload as jest.Mock).mockReset().mockResolvedValue({})
})
const last = () => (api as jest.Mock).mock.calls.at(-1)

test('threads and messages use their routes, methods and query', async () => {
  await listThreads()
  expect(last()).toEqual(['/app-api/v1/threads'])
  await listMessages('t1')
  expect(last()).toEqual(['/app-api/v1/threads/t1/messages'])
  const cursor = '2027-01-05T09:00:00.000Z|0b0f6c1e-0000-4000-8000-000000000001'
  await listMessages('t1', cursor)
  expect(last()).toEqual([`/app-api/v1/threads/t1/messages?after=${encodeURIComponent(cursor)}`])
  await sendMessage('t1', 'Hello')
  expect(last()).toEqual(['/app-api/v1/threads/t1/messages', { method: 'POST', body: { body: 'Hello' } }])
})

test('a photo goes to the thread photo route as the file part', async () => {
  const file = { uri: 'file:///p.jpg', name: 'photo.jpg', type: 'image/jpeg' }
  await sendPhoto('t1', file)
  expect(upload).toHaveBeenCalledWith('/app-api/v1/threads/t1/photos', file, {})
})

test('report and block calls use their routes, methods and bodies', async () => {
  await reportMessage('m1', 'Rude')
  expect(last()).toEqual(['/app-api/v1/messages/m1/report', { method: 'POST', body: { reason: 'Rude' } }])
  await blockUser('t1')
  expect(last()).toEqual(['/app-api/v1/blocks', { method: 'POST', body: { threadId: 't1' } }])
  await unblockUser('u 1')
  expect(last()).toEqual(['/app-api/v1/blocks/u%201', { method: 'DELETE' }])
  await listBlocks()
  expect(last()).toEqual(['/app-api/v1/blocks'])
})

const thread = (id: string, extra: object) => ({ id, requestId: null, bookingId: null, otherName: 'A', lastMessageAt: null, blocked: false, ...extra })
const booking = { id: 'b1', quoteId: null, customerId: 'c1', providerId: 'p1' }

test('the chat of a request is found by its request id', async () => {
  ;(api as jest.Mock).mockResolvedValue({ docs: [thread('t1', { requestId: 'r1' }), thread('t2', { requestId: 'r2' })] })
  expect(await threadIdForRequest('r2')).toBe('t2')
  expect(await threadIdForRequest('r9')).toBeNull()
})

test('a direct booking has its own chat, a quote booking shares the chat of the request that holds its quote', async () => {
  const threads = { docs: [thread('t1', { requestId: 'r1' }), thread('t2', { requestId: 'r2' }), thread('t3', { bookingId: 'b1' })] }
  const requests = { docs: [{ id: 'r1', customerId: 'c1', providerId: 'p1' }, { id: 'r2', customerId: 'c1', providerId: 'p1' }, { id: 'r3', customerId: 'c9', providerId: 'p1' }] }
  ;(api as jest.Mock).mockImplementation(async (path: string) => {
    if (path.endsWith('/threads')) return threads
    if (path.includes('/requests?')) return requests
    return { docs: [{ id: path.includes('/r2/') ? 'q2' : 'q1' }] }
  })
  expect(await threadIdForBooking(booking, 'customer')).toBe('t3')
  expect(await threadIdForBooking({ ...booking, id: 'b2', quoteId: 'q2' }, 'customer')).toBe('t2')
  expect(await threadIdForBooking({ ...booking, id: 'b2', quoteId: 'q-unknown' }, 'customer')).toBeNull()
})
