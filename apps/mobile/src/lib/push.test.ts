import Constants from 'expo-constants'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'

import { removePushToken, savePushToken } from '@/api/push'

import { pushRoute, registerForPush, unregisterPush } from './push'

jest.mock('expo-device', () => ({ isDevice: true }))
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { eas: { projectId: 'proj-1' } } } } }))
jest.mock('expo-notifications', () => ({
  setNotificationChannelAsync: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  AndroidImportance: { DEFAULT: 3 },
}))
jest.mock('@/api/push', () => ({ savePushToken: jest.fn(), removePushToken: jest.fn() }))
jest.mock('@/api/client', () => ({ REQUEST_TIMEOUT_MS: 50 }))

const n = jest.mocked(Notifications)
const save = jest.mocked(savePushToken)
const remove = jest.mocked(removePushToken)
const device = Device as { isDevice: boolean }
const extra = Constants.expoConfig!.extra as { eas?: { projectId?: string } }
const TOKEN = 'ExponentPushToken[abc]'

beforeEach(async () => {
  jest.clearAllMocks()
  device.isDevice = true
  extra.eas = { projectId: 'proj-1' }
  n.getPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true } as never)
  n.requestPermissionsAsync.mockResolvedValue({ granted: true } as never)
  n.getExpoPushTokenAsync.mockResolvedValue({ type: 'expo', data: TOKEN })
  save.mockResolvedValue(null)
  remove.mockResolvedValue(null)
  await unregisterPush() // forget the last test's token
  jest.clearAllMocks()
})

test('a granted device registers its token with the project id, once per session', async () => {
  await Promise.all([registerForPush(), registerForPush()])
  await registerForPush()
  expect(n.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'proj-1' })
  expect(save).toHaveBeenCalledTimes(1)
  expect(save).toHaveBeenCalledWith(TOKEN, expect.stringMatching(/^(ios|android)$/))
})

test('asks for permission only when not granted yet', async () => {
  n.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true } as never)
  await registerForPush()
  expect(n.requestPermissionsAsync).toHaveBeenCalled()
  expect(save).toHaveBeenCalledTimes(1)
})

test('refused permission: no token, no throw, and a later call (switch turned on) tries again', async () => {
  n.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true } as never)
  n.requestPermissionsAsync.mockResolvedValue({ granted: false } as never)
  await expect(registerForPush()).resolves.toBeUndefined()
  expect(n.getExpoPushTokenAsync).not.toHaveBeenCalled()
  expect(save).not.toHaveBeenCalled()
  n.requestPermissionsAsync.mockResolvedValue({ granted: true } as never)
  await registerForPush()
  expect(save).toHaveBeenCalledTimes(1)
})

test('a simulator quietly does nothing', async () => {
  device.isDevice = false
  await expect(registerForPush()).resolves.toBeUndefined()
  expect(n.getPermissionsAsync).not.toHaveBeenCalled()
  expect(save).not.toHaveBeenCalled()
})

test('a missing project id quietly does nothing', async () => {
  extra.eas = undefined
  await expect(registerForPush()).resolves.toBeUndefined()
  expect(n.getExpoPushTokenAsync).not.toHaveBeenCalled()
  expect(save).not.toHaveBeenCalled()
})

test('a failed save or token fetch never throws, and the next call retries', async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  save.mockRejectedValueOnce(new Error('network'))
  await expect(registerForPush()).resolves.toBeUndefined()
  n.getExpoPushTokenAsync.mockRejectedValueOnce(new Error('no FCM'))
  await expect(registerForPush()).resolves.toBeUndefined()
  await registerForPush()
  expect(save).toHaveBeenCalledTimes(2)
})

test('sign-out deletes this device token, once; a failure never throws', async () => {
  await registerForPush()
  remove.mockRejectedValueOnce(new Error('network'))
  await expect(unregisterPush()).resolves.toBeUndefined()
  expect(remove).toHaveBeenCalledWith(TOKEN)
  await unregisterPush()
  expect(remove).toHaveBeenCalledTimes(1)
  // The next session registers again.
  await registerForPush()
  expect(save).toHaveBeenCalledTimes(2)
})

test('sign-out during a registration waits for it, then deletes the token', async () => {
  const reg = registerForPush()
  await unregisterPush()
  await reg
  expect(remove).toHaveBeenCalledWith(TOKEN)
})

test('sign-out with nothing registered sends nothing', async () => {
  await unregisterPush()
  expect(remove).not.toHaveBeenCalled()
})

test.each([
  ['skilled://bookings/b1', '/bookings/b1'],
  ['skilled://bookings/request/r-2', '/bookings/request/r-2'],
  ['skilled://threads/t_3', '/threads/t_3'],
  ['skilled://invoices/9f1c', '/invoices/9f1c'],
  ['skilled://provider/anna-berg', '/provider/anna-berg'],
  ['skilled://my-profile', '/my-profile'],
])('a tap on %s opens %s', (url, route) => expect(pushRoute(url)).toBe(route))

test.each([
  undefined,
  null,
  42,
  '',
  'https://evil.example/bookings/b1',
  'skilled://admin',
  'skilled://bookings',
  'skilled://bookings/b1/../../admin',
  'skilled://bookings/b1?x=1',
  'skilled://threads/',
  'skilled://invoices/a/b',
  'otherapp://bookings/b1',
  'skilled://bookings/b1\n',
])('anything else (%p) is ignored', (url) => expect(pushRoute(url)).toBeNull())

// Last: the hung registration stays pending for the rest of this file.
test('sign-out does not wait for a registration that never answers', async () => {
  n.getExpoPushTokenAsync.mockReturnValue(new Promise(() => {}))
  registerForPush()
  await expect(unregisterPush()).resolves.toBeUndefined()
  expect(remove).not.toHaveBeenCalled()
})
