import { AcceptQuoteInputSchema, parseBody } from '@kando/contract'
import { acceptQuote } from '@kando/domain'
import { appRequest } from '../../../../../../lib/app-request'

export const POST = appRequest({ auth: 'required', maxBodyBytes: 16_384 }, async ({ tx, user, request, params }) => {
  const input = await parseBody(AcceptQuoteInputSchema, request)
  return Response.json(await acceptQuote(tx, user!.id, params.id!, input))
})
