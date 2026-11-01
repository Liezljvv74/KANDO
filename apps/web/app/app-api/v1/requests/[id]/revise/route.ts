import { parseBody, TimeProposalSchema } from '@kando/contract'
import { reviseRequest } from '@kando/domain'
import { appRequest } from '../../../../../../lib/app-request'

export const POST = appRequest({ auth: 'required', maxBodyBytes: 16_384 }, async ({ tx, user, request, params, afterCommit }) => {
  const input = await parseBody(TimeProposalSchema, request)
  return Response.json(await reviseRequest(tx, user!.id, params.id!, input, new Date(), afterCommit))
})
