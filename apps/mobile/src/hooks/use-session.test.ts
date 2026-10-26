import * as auth from '@/api/auth'
import * as client from '@/api/client'

import { chooseLanguage, getSession, loadSession, resetSession, signIn, signOut, signUp, updateName, verify } from './use-session'

jest.mock('@/api/auth')
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

beforeEach(() => {
  resetSession()
  jest.resetAllMocks()
  api.updateMe.mockResolvedValue({})
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
  expect(api.updateMe).toHaveBeenCalledWith({ name: 'Anna', language: 'en' })
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

test('updateName saves the account name in both places and updates the session user; a failure keeps the old one', async () => {
  a.signIn.mockResolvedValueOnce(user)
  await signIn('a@b.de', 'secret123')
  await updateName('Anna Berg')
  expect(api.updateMe).toHaveBeenCalledWith({ name: 'Anna Berg' })
  expect(a.updateUserName).toHaveBeenCalledWith('Anna Berg')
  expect(getSession().user).toEqual({ ...user, name: 'Anna Berg' })
  api.updateMe.mockRejectedValueOnce(new client.ApiError(400, 'Invalid name'))
  await expect(updateName('')).rejects.toMatchObject({ status: 400 })
  expect(getSession().user?.name).toBe('Anna Berg')
})

test('switching the language also saves it for emails, but only while signed in', async () => {
  chooseLanguage('de')
  expect(api.updateMe).not.toHaveBeenCalled()
  a.signIn.mockResolvedValueOnce(user)
  await signIn('a@b.de', 'secret123')
  chooseLanguage('en')
  expect(api.updateMe).toHaveBeenCalledWith({ language: 'en' })
})
