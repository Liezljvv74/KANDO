import { api, upload } from '@/api/client'
import { blockUser, getThread, listBlocks, listMessages, listThreads, reportMessage, sendMessage, sendPhoto, unblockUser } from './chat'

jest.mock('@/api/client', () => ({ api: jest.fn(), upload: jest.fn() }))

beforeEach(() => {
  ;(api as jest.Mock).mockReset().mockResolvedValue({ docs: [] })
  ;(upload as jest.Mock).mockReset().mockResolvedValue({})
})
const last = () => (api as jest.Mock).mock.calls.at(-1)

test('threads and messages use their routes, methods and query', async () => {
  await listThreads()
  expect(last()).toEqual(['/app-api/v1/threads'])
  await listThreads('c|1')
  expect(last()).toEqual(['/app-api/v1/threads?cursor=c%7C1'])
  await getThread('t 1')
  expect(last()).toEqual(['/app-api/v1/threads/t%201'])
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
  await unblockUser('t 1')
  expect(last()).toEqual(['/app-api/v1/blocks?threadId=t%201', { method: 'DELETE' }])
  await listBlocks()
  expect(last()).toEqual(['/app-api/v1/blocks'])
})

test('the thread list returns the page with its next cursor', async () => {
  const page = { docs: [{ id: 't1' }], next: null }
  ;(api as jest.Mock).mockResolvedValue(page)
  expect(await listThreads()).toEqual(page)
})
