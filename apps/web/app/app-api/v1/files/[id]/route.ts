import { deleteFile, fileLink } from '@kando/domain'
import { appRequest } from '../../../../../lib/app-request'

const notFound = () => Response.json({ error: 'Not found' }, { status: 404 })

export const GET = appRequest({ auth: 'required' }, async ({ tx, user, params }) => {
  const url = await fileLink(tx, user!.id, params.id!)
  return url ? Response.json({ url }) : notFound()
})

/** An uploaded file no check uses yet (e.g. after a failed submit). */
export const DELETE = appRequest({ auth: 'required' }, async ({ tx, user, params }) =>
  (await deleteFile(tx, user!.id, params.id!)) ? new Response(null, { status: 204 }) : notFound(),
)
