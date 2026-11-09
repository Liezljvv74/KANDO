import { parseBody, RequestInputSchema } from '@kando/contract'
import { createRequest } from '@kando/domain'
import { appRequest } from '@/lib/app-request'

export const POST = appRequest({ auth: 'required', maxBodyBytes: 16_384 }, async ({ tx, user, request, afterCommit }) => {
  const input = await parseBody(RequestInputSchema, request)
  return Response.json(await createRequest(tx, user!.id, input, new Date(), afterCommit), { status: 201 })
})
