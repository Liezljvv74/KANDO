import { api } from '@/api/client'
import {
  acceptQuote,
  answerStop,
  cancelBooking,
  confirmJob,
  finishJob,
  getDispute,
  objectNoShow,
  openDispute,
  reportNoShow,
  startAdditionalTask,
  stateStopAmount,
  stopJob,
  createRequest,
  getBooking,
  getBusyTimes,
  getRequest,
  listQuotes,
  sendQuote,
  withdrawBooking,
} from './bookings'

jest.mock('@/api/client', () => ({ api: jest.fn() }))

beforeEach(() => (api as jest.Mock).mockReset().mockResolvedValue({ docs: [] }))
const last = () => (api as jest.Mock).mock.calls.at(-1)

test('requests and quotes use their routes, methods and bodies', async () => {
  const request = { providerId: 'p1', description: 'Fix the tap' }
  await createRequest(request)
  expect(last()).toEqual(['/app-api/v1/requests', { method: 'POST', body: request }])
  await getRequest('r1')
  expect(last()).toEqual(['/app-api/v1/requests/r1'])
  await listQuotes('r1')
  expect(last()).toEqual(['/app-api/v1/requests/r1/quotes'])
  await sendQuote('r1', { amount: 90, scope: 'All of it' })
  expect(last()).toEqual(['/app-api/v1/requests/r1/quotes', { method: 'POST', body: { amount: 90, scope: 'All of it' } }])
  await acceptQuote('q1', { note: 'Thanks' })
  expect(last()).toEqual(['/app-api/v1/quotes/q1/accept', { method: 'POST', body: { note: 'Thanks' } }])
})

test('bookings use their routes, methods and bodies', async () => {
  await getBooking('b 1')
  expect(last()).toEqual(['/app-api/v1/bookings/b%201'])
  await withdrawBooking('b1')
  expect(last()).toEqual(['/app-api/v1/bookings/b1/withdraw', { method: 'POST', body: undefined }])
})

test('busy times pass the range as ISO dates and return the list', async () => {
  const busy = [{ startAt: 'a', endAt: 'b', state: 'pending' }]
  ;(api as jest.Mock).mockResolvedValueOnce({ docs: busy })
  const from = new Date('2027-01-01T00:00:00Z')
  const to = new Date('2027-01-31T00:00:00Z')
  expect(await getBusyTimes('anna h', from, to)).toEqual(busy)
  expect(last()![0]).toBe('/app-api/v1/providers/anna%20h/busy?from=2027-01-01T00%3A00%3A00.000Z&to=2027-01-31T00%3A00%3A00.000Z')
})

test('the endings use their routes, methods and bodies', async () => {
  const calls: [() => Promise<unknown>, string, unknown][] = [
    [() => finishJob('b1', {}), '/app-api/v1/bookings/b1/finish', {}], // the route needs a JSON body, even an empty one
    [() => finishJob('b1', { materialAmount: 12.5 }), '/app-api/v1/bookings/b1/finish', { materialAmount: 12.5 }],
    [() => confirmJob('b1'), '/app-api/v1/bookings/b1/confirm', undefined],
    [() => cancelBooking('b1'), '/app-api/v1/bookings/b1/cancel', undefined],
    [() => reportNoShow('b1'), '/app-api/v1/bookings/b1/no-show', undefined],
    [() => objectNoShow('b1', 'I was there at 9'), '/app-api/v1/bookings/b1/no-show/object', { description: 'I was there at 9' }],
    [() => openDispute('b1', 'The tap still drips'), '/app-api/v1/bookings/b1/dispute', { description: 'The tap still drips' }],
    [() => stopJob('b1'), '/app-api/v1/bookings/b1/stop', undefined],
    [() => stateStopAmount('b1', { amount: 40, note: '2 of 5 hours' }), '/app-api/v1/bookings/b1/stop/amount', { amount: 40, note: '2 of 5 hours' }],
    [() => answerStop('b1', false), '/app-api/v1/bookings/b1/stop/answer', { agree: false }],
    [() => startAdditionalTask('b1', 'Also the shower'), '/app-api/v1/bookings/b1/additional-task', { description: 'Also the shower' }],
  ]
  for (const [call, path, body] of calls) {
    await call()
    expect(last()).toEqual([path, { method: 'POST', body }])
  }
  await getDispute('b 1')
  expect(last()).toEqual(['/app-api/v1/bookings/b%201/dispute'])
})
