import * as auth from '@/api/auth'
import * as client from '@/api/client'
import * as profile from '@/api/my-profile'
import { loadMe } from '@/hooks/use-me'
import { loadPending, savePending, clearPending } from '@/lib/pending-signup'

import { chooseLanguage, getSession, loadSession, resetSession, signIn, signOut, signUp, verify } from './use-session'

jest.mock('@/api/auth')
jest.mock('@/hooks/use-me', () => ({ clearMe: jest.fn(), loadMe: jest.fn() }))
let mockFileExists = true
jest.mock('expo-file-system', () => ({ File: class { get exists() { return mockFileExists } } }))
jest.mock('@/api/my-profile', () => ({ photosApi: { add: jest.fn() } }))
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>()
  return {
    // Plain functions: beforeEach's resetAllMocks would wipe jest.fn implementations.
    getItemAsync: async (k: string) => store.get(k) ?? null,
    setItemAsync: async (k: string, v: string) => void store.set(k, v),
    deleteItemAsync: async (k: string) => void store.delete(k),
  }
})
jest.mock('@/i18n', () => ({ getLang: () => 'en', setLang: jest.fn() }))
jest.mock('@/api/client', () => ({
  setOnUnauthorized: jest.fn(),
  updateMe: jest.fn(),
  ApiError: jest.requireActual('@/api/client').ApiError,
}))
const a = jest.mocked(auth)
const api = jest.mocked(client)
const user = { id: 'u1', name: 'A', email: 'a@b.de', emailVerified: true }
const unverified = { ...user, emailVerified: false }
// Registered once at import, before beforeEach resets the mocks.
const onUnauthorized = api.setOnUnauthorized.mock.calls[0][0]!

const photos = jest.mocked(profile.photosApi)
const address = { street: 'Weg 1', postcode: '10115', city: 'Berlin', country: 'DE' }
const pending = { email: 'a@b.de', firstName: 'Anna', lastName: 'Berg', offerServices: true, pictureUri: 'file:///p.jpg', address }

beforeEach(async () => {
  resetSession()
  jest.resetAllMocks()
  api.updateMe.mockResolvedValue({})
  jest.mocked(loadMe).mockResolvedValue({} as never)
  photos.add.mockResolvedValue({} as never)
  await clearPending()
  mockFileExists = true
})

test('loading -> signed in -> signed out', async () => {
  expect(getSession()).toEqual({ user: null, loading: true, offline: false })
  a.session.mockResolvedValueOnce(null)
  await loadSession()
  expect(getSession()).toEqual({ user: null, loading: false, offline: false })
  a.signIn.mockResolvedValueOnce(user)
  await expect(signIn('a@b.de', 'secret123')).resolves.toBe('signed-in')
  expect(getSession().user).toEqual(user)
  a.signOut.mockResolvedValueOnce()
  await signOut()
  expect(getSession().user).toBeNull()
  expect(a.signOut).toHaveBeenCalledTimes(1)
})

test('an unverified email never counts as signed in: sign-in sends a code and asks for it', async () => {
  a.signIn.mockResolvedValueOnce(unverified)
  await expect(signIn('a@b.de', 'secret123')).resolves.toBe('verify')
  expect(a.sendVerificationCode).toHaveBeenCalledWith('a@b.de')
  expect(getSession().user).toBeNull()
  a.session.mockResolvedValueOnce(unverified)
  await loadSession()
  expect(getSession().user).toBeNull()
})

test('a server that refuses unverified sign-ins (EMAIL_NOT_VERIFIED) also leads to the code screen', async () => {
  a.signIn.mockRejectedValueOnce(new client.ApiError(403, 'EMAIL_NOT_VERIFIED'))
  await expect(signIn('a@b.de', 'secret123')).resolves.toBe('verify')
  expect(a.sendVerificationCode).toHaveBeenCalledWith('a@b.de')
})

test('sign-up creates the account and sends the code; the right code signs in and saves the account name', async () => {
  a.signUp.mockResolvedValueOnce(unverified)
  await signUp('Anna', 'a@b.de', 'secret123')
  expect(a.signUp).toHaveBeenCalledWith('a@b.de', 'secret123', 'Anna')
  expect(a.sendVerificationCode).toHaveBeenCalledWith('a@b.de')
  expect(getSession().user).toBeNull()
  a.verifyEmail.mockResolvedValueOnce({ ...user, name: 'Anna' })
  await verify('a@b.de', '123456')
  expect(a.verifyEmail).toHaveBeenCalledWith('a@b.de', '123456')
  expect(getSession().user).toMatchObject({ name: 'Anna' })
  expect(api.updateMe).toHaveBeenCalledWith({ language: 'en' }) // the auth name is never split into first and last
})

test('a wrong code throws and keeps signed out', async () => {
  a.verifyEmail.mockRejectedValueOnce(new client.ApiError(400, 'INVALID_OTP'))
  await expect(verify('a@b.de', '000000')).rejects.toMatchObject({ code: 'INVALID_OTP' })
  expect(getSession().user).toBeNull()
})

test('a failed login rejects and keeps signed out; a server error on load means signed out', async () => {
  a.signIn.mockRejectedValueOnce(new client.ApiError(401, 'INVALID_EMAIL_OR_PASSWORD'))
  await expect(signIn('a', 'b')).rejects.toBeDefined()
  expect(getSession().user).toBeNull()
  a.session.mockRejectedValueOnce(new Error('boom'))
  await loadSession()
  expect(getSession()).toEqual({ user: null, loading: false, offline: false })
})

test('a network error on load sets offline (not signed out); retry recovers', async () => {
  a.session.mockRejectedValueOnce(new client.ApiError(0, 'network'))
  await loadSession()
  expect(getSession()).toEqual({ user: null, loading: false, offline: true })
  a.session.mockResolvedValueOnce(user)
  await loadSession()
  expect(getSession()).toEqual({ user, loading: false, offline: false })
})

test('onUnauthorized from the API client signs the user out', async () => {
  a.signIn.mockResolvedValueOnce(user)
  await signIn('a@b.de', 'secret123')
  onUnauthorized()
  expect(getSession()).toEqual({ user: null, loading: false, offline: false })
})

test('switching the language also saves it for emails, but only while signed in', async () => {
  chooseLanguage('de')
  expect(api.updateMe).not.toHaveBeenCalled()
  a.signIn.mockResolvedValueOnce(user)
  await signIn('a@b.de', 'secret123')
  chooseLanguage('en')
  expect(api.updateMe).toHaveBeenCalledWith({ language: 'en' })
})

test('verify finishes the sign-up: names and address, then the picture, then the record is cleared; returns the tick', async () => {
  await savePending(pending)
  a.verifyEmail.mockResolvedValueOnce(user)
  await expect(verify('a@b.de', '123456')).resolves.toBe(true)
  expect(api.updateMe).toHaveBeenCalledWith({ firstName: 'Anna', lastName: 'Berg', language: 'en', address })
  expect(photos.add).toHaveBeenCalledWith({ uri: 'file:///p.jpg', name: 'photo.jpg', type: 'image/jpeg' }, 'profile')
  expect(api.updateMe.mock.invocationCallOrder[0]).toBeLessThan(photos.add.mock.invocationCallOrder[0])
  expect(await loadPending()).toBeNull()
})

test('a failed upload keeps the record; loadSession retries it once and clears it', async () => {
  await savePending(pending)
  a.verifyEmail.mockResolvedValueOnce(user)
  photos.add.mockRejectedValueOnce(new client.ApiError(0, 'network'))
  await verify('a@b.de', '123456')
  expect(getSession().user).toEqual(user)
  expect(await loadPending()).toMatchObject({ pictureUri: 'file:///p.jpg' })
  a.session.mockResolvedValueOnce(user)
  await loadSession()
  await new Promise((r) => setTimeout(r, 0))
  expect(api.updateMe).toHaveBeenCalledTimes(1)
  expect(photos.add).toHaveBeenCalledTimes(2)
  expect(await loadPending()).toBeNull()
})

test('loadSession without a record or while signed out does not finish a sign-up', async () => {
  a.session.mockResolvedValueOnce(user)
  await loadSession()
  await savePending(pending)
  a.session.mockResolvedValueOnce(null)
  await loadSession()
  await new Promise((r) => setTimeout(r, 0))
  expect(api.updateMe).not.toHaveBeenCalled()
})

test('a record for another email is dropped and applies nothing', async () => {
  await savePending({ ...pending, email: 'other@b.de' })
  a.verifyEmail.mockResolvedValueOnce(user)
  await expect(verify('a@b.de', '123456')).resolves.toBe(false)
  expect(photos.add).not.toHaveBeenCalled()
  expect(api.updateMe).not.toHaveBeenCalledWith(expect.objectContaining({ firstName: 'Anna' }))
  expect(await loadPending()).toBeNull()
})

test('a failed PATCH keeps the full record', async () => {
  await savePending(pending)
  a.verifyEmail.mockResolvedValueOnce(user)
  api.updateMe.mockRejectedValueOnce(new client.ApiError(0, 'network'))
  await verify('a@b.de', '123456')
  expect(photos.add).not.toHaveBeenCalled()
  expect(await loadPending()).toEqual(pending)
})

test('a postcode the server calls invalid does not block the names: they are saved without the address', async () => {
  await savePending(pending)
  a.verifyEmail.mockResolvedValueOnce(user)
  api.updateMe.mockRejectedValueOnce(new client.ApiError(400, 'Invalid postcode'))
  await verify('a@b.de', '123456')
  expect(api.updateMe).toHaveBeenLastCalledWith({ firstName: 'Anna', lastName: 'Berg', language: 'en' })
  expect(photos.add).toHaveBeenCalled()
  expect(await loadPending()).toBeNull()
})

test('after the PATCH succeeded, a failed upload keeps only email, tick and picture; the retry does not PATCH again', async () => {
  await savePending(pending)
  a.verifyEmail.mockResolvedValueOnce(user)
  photos.add.mockRejectedValueOnce(new client.ApiError(0, 'network'))
  await verify('a@b.de', '123456')
  expect(await loadPending()).toEqual({ email: 'a@b.de', offerServices: true, pictureUri: 'file:///p.jpg' })
  a.session.mockResolvedValueOnce(user)
  await loadSession()
  await new Promise((r) => setTimeout(r, 0))
  expect(api.updateMe).toHaveBeenCalledTimes(1)
  expect(photos.add).toHaveBeenCalledTimes(2)
  expect(await loadPending()).toBeNull()
})

test('a picture whose cached file is gone is dropped and the record cleared', async () => {
  await savePending(pending)
  mockFileExists = false
  a.verifyEmail.mockResolvedValueOnce(user)
  await verify('a@b.de', '123456')
  expect(photos.add).not.toHaveBeenCalled()
  expect(await loadPending()).toBeNull()
})

test('sign-up keeps the record for the code step; a failed sign-up leaves none', async () => {
  a.signUp.mockResolvedValueOnce(unverified)
  await signUp('Anna Berg', 'a@b.de', 'secret123', pending)
  expect(await loadPending()).toEqual(pending)
  a.signUp.mockRejectedValueOnce(new client.ApiError(422, 'USER_ALREADY_EXISTS'))
  await expect(signUp('Anna Berg', 'a@b.de', 'secret123', pending)).rejects.toBeDefined()
  expect(await loadPending()).toBeNull()
})

test('finishing a sign-up reloads /me so the home nudge sees the new picture; nothing to finish, nothing to reload', async () => {
  await savePending(pending)
  a.verifyEmail.mockResolvedValueOnce(user)
  await verify('a@b.de', '123456')
  expect(loadMe).toHaveBeenCalledTimes(1)
  expect(photos.add.mock.invocationCallOrder[0]).toBeLessThan(jest.mocked(loadMe).mock.invocationCallOrder[0])
  jest.mocked(loadMe).mockClear()
  a.verifyEmail.mockResolvedValueOnce(user)
  await verify('a@b.de', '123456')
  expect(loadMe).not.toHaveBeenCalled()
})
