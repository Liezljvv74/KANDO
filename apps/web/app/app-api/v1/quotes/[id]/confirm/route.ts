import { ConfirmQuoteInputSchema, parseBody } from '@kando/contract'
import { confirmQuote } from '@kando/domain'
import { appRequest } from '../../../../../../lib/app-request'

export const POST = appRequest({ auth: 'required', maxBodyBytes: 16_384 }, async ({ tx, user, request, params, afterCommit }) => {
  const input = await parseBody(ConfirmQuoteInputSchema, request)
  return Response.json(await confirmQuote(tx, user!.id, params.id!, input, new Date(), afterCommit))
})
