import { deleteFile, fileLink, notFound } from '@kando/domain'
import { appRequest } from '../../../../../lib/app-request'

export const GET = appRequest({ auth: 'required' }, async ({ tx, user, params }) => {
  const url = await fileLink(tx, user!.id, params.id!)
  return url ? Response.json({ url }) : notFound()
})

/** An uploaded file no check uses yet (e.g. after a failed submit). */
export const DELETE = appRequest({ auth: 'required' }, async ({ tx, user, params, afterCommit }) =>
  (await deleteFile(tx, user!.id, params.id!, afterCommit)) ? new Response(null, { status: 204 }) : notFound(),
)
