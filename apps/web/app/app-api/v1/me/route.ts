import { DeleteMeSchema, MePatchSchema, parseBody } from '@kando/contract'
import { deleteAccount, getMe, updateMe } from '@kando/domain'
import { appRequest } from '../../../../lib/app-request'
import { verifyPassword } from '../../../../lib/auth/server'
import { refreshPublicPages } from '../../../../lib/public-cache'

export const GET = appRequest({ auth: 'required' }, async ({ tx, user }) => Response.json(await getMe(tx, user!.id)))

export const PATCH = appRequest({ auth: 'required', maxBodyBytes: 4096 }, async ({ tx, user, request }) => {
  const me = await updateMe(tx, user!.id, await parseBody(MePatchSchema, request))
  refreshPublicPages('providers') // the name on a provider page
  return Response.json(me)
})

// Erases the person (GDPR) on the owner connection inside the domain, after the request transaction (the password check
// calls Neon Auth, which must not hold a request connection). The password is checked first: 403 WRONG_PASSWORD, 503 AUTH_BUSY.
export const DELETE = appRequest({ auth: 'required', maxBodyBytes: 4096 }, async ({ user, request, afterCommit }) => {
  const { password } = await parseBody(DeleteMeSchema, request)
  return async () => {
    const check = await verifyPassword(request, user!.email, password)
    if (check === 'wrong') return Response.json({ error: 'WRONG_PASSWORD' }, { status: 403 })
    if (check === 'busy') return Response.json({ error: 'AUTH_BUSY' }, { status: 503 })
    await deleteAccount(user!.id, afterCommit)
    refreshPublicPages('providers')
    return Response.json({ ok: true })
  }
})
