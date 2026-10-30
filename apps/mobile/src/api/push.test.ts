import { api } from '@/api/client'
import { getPushSettings, removePushToken, savePushToken, setPushSettings } from './push'

jest.mock('@/api/client', () => ({ ...jest.requireActual('@/api/client'), api: jest.fn() }))

beforeEach(() => (api as jest.Mock).mockReset().mockResolvedValue({ chat: true, reminders: true }))

test('saving the token POSTs it with the platform', async () => {
  await savePushToken('ExponentPushToken[x]', 'ios')
  expect(api).toHaveBeenCalledWith('/app-api/v1/push-tokens', { method: 'POST', body: { token: 'ExponentPushToken[x]', platform: 'ios' } })
})

test('removing the token is a DELETE with the token in the body, never the URL', async () => {
  await removePushToken('ExponentPushToken[x]')
  expect(api).toHaveBeenCalledWith('/app-api/v1/push-tokens', { method: 'DELETE', body: { token: 'ExponentPushToken[x]' } })
})

test('the switches are read with GET and changed with PATCH of /me/push', async () => {
  expect(await getPushSettings()).toEqual({ chat: true, reminders: true })
  expect(api).toHaveBeenCalledWith('/app-api/v1/me/push')
  await setPushSettings({ chat: false })
  expect(api).toHaveBeenCalledWith('/app-api/v1/me/push', { method: 'PATCH', body: { chat: false } })
})
