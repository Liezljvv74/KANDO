import { MessageInputSchema, MessagesQuerySchema, parseBody, parseQuery } from '@kando/contract'
import { listMessages, sendMessage } from '@kando/domain'
import { appRequest } from '../../../../../../lib/app-request'

export const GET = appRequest({ auth: 'required' }, async ({ tx, user, request, params }) =>
  Response.json({ docs: await listMessages(tx, user!.id, params.id!, parseQuery(MessagesQuerySchema, request).after) }),
)

export const POST = appRequest({ auth: 'required', maxBodyBytes: 16_384 }, async ({ tx, user, request, params, afterCommit }) => {
  const input = await parseBody(MessageInputSchema, request)
  return Response.json(await sendMessage(tx, user!.id, params.id!, input, afterCommit), { status: 201 })
})
