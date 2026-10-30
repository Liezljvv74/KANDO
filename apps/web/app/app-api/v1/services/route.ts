import { parseBody, ServiceInputSchema } from '@kando/contract'
import { addService, listServices } from '@kando/domain'
import { appRequest } from '../../../../lib/app-request'
import { refreshPublicPages } from '../../../../lib/public-cache'

export const GET = appRequest({ auth: 'required' }, async ({ tx, user }) =>
  Response.json({ docs: await listServices(tx, user!.id) }),
)

export const POST = appRequest({ auth: 'required', maxBodyBytes: 16_384 }, async ({ tx, user, request }) => {
  const input = await parseBody(ServiceInputSchema, request)
  const created = await addService(tx, user!.id, input)
  refreshPublicPages('providers')
  return Response.json(created, { status: 201 })
})
