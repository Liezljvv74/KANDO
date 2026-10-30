import { parseBody, ReferencePatchSchema } from '@kando/contract'
import { deleteReference, updateReference } from '@kando/domain'
import { appRequest } from '../../../../../lib/app-request'
import { refreshPublicPages } from '../../../../../lib/public-cache'

const notFound = () => Response.json({ error: 'Not found' }, { status: 404 })

export const PATCH = appRequest({ auth: 'required', maxBodyBytes: 16_384 }, async ({ tx, user, request, params }) => {
  const patch = await parseBody(ReferencePatchSchema, request)
  const reference = await updateReference(tx, user!.id, params.id!, patch)
  if (!reference) return notFound()
  refreshPublicPages('providers')
  return Response.json(reference)
})

export const DELETE = appRequest({ auth: 'required' }, async ({ tx, user, params }) => {
  if (!(await deleteReference(tx, user!.id, params.id!))) return notFound()
  refreshPublicPages('providers')
  return new Response(null, { status: 204 })
})
