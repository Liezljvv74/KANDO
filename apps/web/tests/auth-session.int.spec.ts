import { expect, it } from 'vitest'
import { AuthUnavailableError } from '@kando/domain'
import { sessionFromAuthResponse } from '../lib/auth/server'

const user = { id: 'u1', email: 'u1@test.skilled.invalid', emailVerified: true, name: 'Anna' }

it('sessionFromAuthResponse: 200 user, 200 null, 401, 429, 500', async () => {
  expect(await sessionFromAuthResponse(Response.json({ session: {}, user }))).toEqual(user)
  expect(await sessionFromAuthResponse(Response.json(null))).toBeNull()
  expect(await sessionFromAuthResponse(new Response(null, { status: 401 }))).toBeNull()
  // A busy or broken login server is not a sign-out: it throws, so the wrapper answers 503, never 401.
  await expect(sessionFromAuthResponse(new Response('slow down', { status: 429 }))).rejects.toBeInstanceOf(AuthUnavailableError)
  await expect(sessionFromAuthResponse(new Response(null, { status: 500 }))).rejects.toBeInstanceOf(AuthUnavailableError)
})
