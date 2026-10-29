import { unblockUser } from '@kando/domain'
import { appRequest } from '../../../../../lib/app-request'

export const DELETE = appRequest({ auth: 'required' }, async ({ tx, user, params }) => {
  await unblockUser(tx, user!.id, params.userId!)
  return new Response(null, { status: 204 })
})
