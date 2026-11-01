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
  answerBooking,
  createRequest,
  getBooking,
  getBusyTimes,
  getRequest,
  listBookings,
  listQuotes,
  listRequests,
  sendQuote,
  withdrawBooking,
} from './bookings'

jest.mock('@/api/client', () => ({ api: jest.fn() }))

const time = { startAt: '2027-01-05T09:00:00.000Z', durationMin: 60, onSite: false }

beforeEach(() => (api as jest.Mock).mockReset().mockResolvedValue({ docs: [] }))
const last = () => (api as jest.Mock).mock.calls.at(-1)

test('requests and quotes use their routes, methods and bodies', async () => {
  const request = { providerId: 'p1', description: 'Fix the tap' }
  await createRequest(request)
  expect(last()).toEqual(['/app-api/v1/requests', { method: 'POST', body: request }])
  await listRequests('provider')
  expect(last()).toEqual(['/app-api/v1/requests?role=provider'])
  await listRequests('provider', '2027-01-05T09:00:00.000000Z|0b0f6c1e-0000-4000-8000-000000000001')
  expect(last()).toEqual(['/app-api/v1/requests?role=provider&cursor=2027-01-05T09%3A00%3A00.000000Z%7C0b0f6c1e-0000-4000-8000-000000000001'])
  await getRequest('r1')
  expect(last()).toEqual(['/app-api/v1/requests/r1'])
  await listQuotes('r1')
  expect(last()).toEqual(['/app-api/v1/requests/r1/quotes'])
  await sendQuote('r1', { amount: 90, scope: 'All of it' })
  expect(last()).toEqual(['/app-api/v1/requests/r1/quotes', { method: 'POST', body: { amount: 90, scope: 'All of it' } }])
  await acceptQuote('q1', time)
  expect(last()).toEqual(['/app-api/v1/quotes/q1/accept', { method: 'POST', body: time }])
})

test('bookings use their routes, methods and bodies', async () => {
  await listBookings('customer')
  expect(last()).toEqual(['/app-api/v1/bookings?role=customer'])
  await listBookings('provider', 'c|1')
  expect(last()).toEqual(['/app-api/v1/bookings?role=provider&cursor=c%7C1'])
  await getBooking('b 1')
  expect(last()).toEqual(['/app-api/v1/bookings/b%201'])
  await answerBooking('b1', { type: 'counter', startAt: time.startAt, durationMin: 90, onSite: true })
  expect(last()).toEqual(['/app-api/v1/bookings/b1/answer', { method: 'POST', body: { type: 'counter', startAt: time.startAt, durationMin: 90, onSite: true } }])
  await answerBooking('b1', { type: 'accept' })
  expect(last()![1].body).toEqual({ type: 'accept' })
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

test('lists return the page with its next cursor', async () => {
  const page = { docs: [{ id: 'b1' }], next: 'c|1' }
  ;(api as jest.Mock).mockResolvedValue(page)
  expect(await listBookings('customer')).toEqual(page)
  expect(await listRequests('customer')).toEqual(page)
})
