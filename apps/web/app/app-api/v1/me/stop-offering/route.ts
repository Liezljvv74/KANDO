import { stopOffering } from '@kando/domain'
import { appRequest } from '../../../../../lib/app-request'
import { refreshPublicPages } from '../../../../../lib/public-cache'

export const POST = appRequest({ auth: 'required', allowWhenSuspended: true }, async ({ tx, user }) => {
  const res = await stopOffering(tx, user!.id)
  refreshPublicPages('providers')
  return Response.json(res)
})
