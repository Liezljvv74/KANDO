import { MePatchSchema, parseBody } from '@kando/contract'
import { getMe, updateMe } from '@kando/domain'
import { appRequest } from '../../../../lib/app-request'

export const GET = appRequest({ auth: 'required' }, async ({ tx, user }) => Response.json(await getMe(tx, user!.id)))

export const PATCH = appRequest({ auth: 'required', maxBodyBytes: 4096 }, async ({ tx, user, request }) =>
  Response.json(await updateMe(tx, user!.id, await parseBody(MePatchSchema, request))),
)
