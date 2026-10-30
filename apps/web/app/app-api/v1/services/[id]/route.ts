import { parseBody, ServicePatchSchema } from '@kando/contract'
import { deleteService, updateService } from '@kando/domain'
import { appRequest } from '../../../../../lib/app-request'
import { refreshPublicPages } from '../../../../../lib/public-cache'

const notFound = () => Response.json({ error: 'Not found' }, { status: 404 })

export const PATCH = appRequest({ auth: 'required', maxBodyBytes: 16_384 }, async ({ tx, user, request, params }) => {
  const patch = await parseBody(ServicePatchSchema, request)
  const service = await updateService(tx, user!.id, params.id!, patch)
  if (!service) return notFound()
  refreshPublicPages('providers')
  return Response.json(service)
})

export const DELETE = appRequest({ auth: 'required' }, async ({ tx, user, params }) => {
  if (!(await deleteService(tx, user!.id, params.id!))) return notFound()
  refreshPublicPages('providers')
  return new Response(null, { status: 204 })
})
