import { deletePhoto } from '@kando/domain'
import { appRequest } from '../../../../../lib/app-request'

export const DELETE = appRequest({ auth: 'required' }, async ({ tx, user, params, afterCommit }) =>
  (await deletePhoto(tx, user!.id, params.id!, afterCommit))
    ? new Response(null, { status: 204 })
    : Response.json({ error: 'Not found' }, { status: 404 }),
)
