import { deletePhoto } from '@kando/domain'
import { appRequest } from '../../../../../lib/app-request'
import { refreshPublicPages } from '../../../../../lib/public-cache'

export const DELETE = appRequest({ auth: 'required' }, async ({ tx, user, params, afterCommit }) => {
  if (!(await deletePhoto(tx, user!.id, params.id!, afterCommit))) return Response.json({ error: 'Not found' }, { status: 404 })
  refreshPublicPages('providers')
  return new Response(null, { status: 204 })
})
