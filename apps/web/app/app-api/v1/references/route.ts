import { parseBody, ReferenceInputSchema } from '@kando/contract'
import { addReference, listReferences } from '@kando/domain'
import { appRequest } from '../../../../lib/app-request'

export const GET = appRequest({ auth: 'required' }, async ({ tx, user }) =>
  Response.json({ docs: await listReferences(tx, user!.id) }),
)

export const POST = appRequest({ auth: 'required', maxBodyBytes: 16_384 }, async ({ tx, user, request }) => {
  const input = await parseBody(ReferenceInputSchema, request)
  return Response.json(await addReference(tx, user!.id, input), { status: 201 })
})
