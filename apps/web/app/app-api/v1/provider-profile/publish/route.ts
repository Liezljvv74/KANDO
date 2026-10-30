import { publish } from '@kando/domain'
import { appRequest } from '../../../../../lib/app-request'
import { refreshPublicPages } from '../../../../../lib/public-cache'

export const POST = appRequest({ auth: 'required' }, async ({ tx, user }) => {
  const profile = await publish(tx, user!.id)
  refreshPublicPages('providers')
  return Response.json(profile)
})
