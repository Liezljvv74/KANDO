import { api } from '@/api/client'
import { notifyMe, payBooking, payoutStatus, startPayoutSetup, stopNotifyMe } from './payments'

jest.mock('@/api/client', () => ({ api: jest.fn() }))

beforeEach(() => (api as jest.Mock).mockReset().mockResolvedValue({}))
const last = () => (api as jest.Mock).mock.calls.at(-1)

test('pay, payout set-up and status call their routes', async () => {
  ;(api as jest.Mock).mockResolvedValue({ url: 'https://pay.test/x' })
  expect(await payBooking('b 1')).toEqual({ url: 'https://pay.test/x' })
  expect(last()).toEqual(['/app-api/v1/bookings/b%201/pay', { method: 'POST' }])
  await startPayoutSetup()
  expect(last()).toEqual(['/app-api/v1/payouts/setup', { method: 'POST' }])
  ;(api as jest.Mock).mockResolvedValue({ ready: true })
  expect(await payoutStatus()).toEqual({ ready: true })
  expect(last()).toEqual(['/app-api/v1/payouts/status'])
})

test('notify me and stop use POST and DELETE on the provider slug', async () => {
  await notifyMe('anna/b')
  expect(last()).toEqual(['/app-api/v1/providers/anna%2Fb/notify-me', { method: 'POST' }])
  await stopNotifyMe('anna')
  expect(last()).toEqual(['/app-api/v1/providers/anna/notify-me', { method: 'DELETE' }])
})
