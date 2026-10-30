import { parseBody, PushTokenDeleteSchema, PushTokenInputSchema } from '@kando/contract'
import { removePushToken, savePushToken } from '@kando/domain'
import { appRequest } from '../../../../lib/app-request'

/** POST /push-tokens: this device's token for the caller (idempotent; a token another person held moves to the caller). */
export const POST = appRequest({ auth: 'required', maxBodyBytes: 1024 }, async ({ user, request }) => {
  await savePushToken(user!.id, await parseBody(PushTokenInputSchema, request))
  return new Response(null, { status: 204 })
})

/** DELETE /push-tokens with { token } in the body (never the URL, which ends up in logs): on sign-out. Idempotent. */
export const DELETE = appRequest({ auth: 'required', maxBodyBytes: 1024 }, async ({ tx, user, request }) => {
  await removePushToken(tx, user!.id, (await parseBody(PushTokenDeleteSchema, request)).token)
  return new Response(null, { status: 204 })
})
