import { parseBody, QuoteInputSchema } from '@kando/contract'
import { listQuotes, sendQuote } from '@kando/domain'
import { appRequest } from '../../../../../../lib/app-request'

export const GET = appRequest({ auth: 'required' }, async ({ tx, user, params }) =>
  Response.json({ docs: await listQuotes(tx, user!.id, params.id!) }),
)

export const POST = appRequest({ auth: 'required', maxBodyBytes: 16_384 }, async ({ tx, user, request, params, afterCommit }) => {
  const input = await parseBody(QuoteInputSchema, request)
  return Response.json(await sendQuote(tx, user!.id, params.id!, input, new Date(), afterCommit), { status: 201 })
})
