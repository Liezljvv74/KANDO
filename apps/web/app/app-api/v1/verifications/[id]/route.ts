import { deleteDocument } from '@kando/domain'
import { appRequest } from '../../../../../lib/app-request'

/** A submitted document, once a replacement for the same requirement exists (409 REPLACEMENT_FIRST before). */
export const DELETE = appRequest({ auth: 'required' }, async ({ user, params, afterCommit }) =>
  (await deleteDocument(user!.id, params.id!, afterCommit))
    ? new Response(null, { status: 204 })
    : Response.json({ error: 'Not found' }, { status: 404 }),
)
