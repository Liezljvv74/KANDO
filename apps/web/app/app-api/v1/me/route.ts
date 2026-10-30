import { DeleteMeSchema, MePatchSchema, parseBody } from '@kando/contract'
import { deleteAccount, getMe, updateMe } from '@kando/domain'
import { appRequest } from '../../../../lib/app-request'
import { refreshPublicPages } from '../../../../lib/public-cache'

export const GET = appRequest({ auth: 'required' }, async ({ tx, user }) => Response.json(await getMe(tx, user!.id)))

export const PATCH = appRequest({ auth: 'required', maxBodyBytes: 4096 }, async ({ tx, user, request }) => {
  const me = await updateMe(tx, user!.id, await parseBody(MePatchSchema, request))
  refreshPublicPages('providers') // the name on a provider page
  return Response.json(me)
})

// Erases the person (GDPR) on the owner connection inside the domain; the request's own transaction is not used.
export const DELETE = appRequest({ auth: 'required', maxBodyBytes: 4096 }, async ({ user, request, afterCommit }) => {
  const { confirmEmail } = await parseBody(DeleteMeSchema, request)
  await deleteAccount(user!.id, confirmEmail, afterCommit)
  refreshPublicPages('providers')
  return Response.json({ ok: true })
})
