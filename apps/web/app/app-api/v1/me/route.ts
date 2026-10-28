import { DeleteMeSchema, MePatchSchema, parseBody } from '@kando/contract'
import { deleteAccount, getMe, updateMe } from '@kando/domain'
import { appRequest } from '../../../../lib/app-request'

export const GET = appRequest({ auth: 'required' }, async ({ tx, user }) => Response.json(await getMe(tx, user!.id)))

export const PATCH = appRequest({ auth: 'required', maxBodyBytes: 4096 }, async ({ tx, user, request }) =>
  Response.json(await updateMe(tx, user!.id, await parseBody(MePatchSchema, request))),
)

// Erases the person (GDPR) on the owner connection inside the domain; the request's own transaction is not used.
export const DELETE = appRequest({ auth: 'required', maxBodyBytes: 4096 }, async ({ user, request, afterCommit }) => {
  const { confirmEmail } = await parseBody(DeleteMeSchema, request)
  await deleteAccount(user!.id, confirmEmail, afterCommit)
  return Response.json({ ok: true })
})
