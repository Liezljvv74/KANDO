import { deleteDocument } from '@kando/domain'
import { appRequest } from '../../../../../lib/app-request'
import { refreshPublicPages } from '../../../../../lib/public-cache'

/** A submitted document, once a replacement for the same requirement exists (409 REPLACEMENT_FIRST before). */
export const DELETE = appRequest({ auth: 'required' }, async ({ user, params, afterCommit }) => {
  if (!(await deleteDocument(user!.id, params.id!, afterCommit))) return Response.json({ error: 'Not found' }, { status: 404 })
  refreshPublicPages('providers') // a deleted approved document can take services offline
  return new Response(null, { status: 204 })
})
