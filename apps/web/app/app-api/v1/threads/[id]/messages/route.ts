import { MessageInputSchema, MessagesQuerySchema, parseBody, parseQuery } from '@kando/contract'
import { listMessages, markThreadNoticesSeen, sendMessage } from '@kando/domain'
import { appRequest } from '../../../../../../lib/app-request'

export const GET = appRequest({ auth: 'required' }, async ({ tx, user, request, params }) => {
  const docs = await listMessages(tx, user!.id, params.id!, parseQuery(MessagesQuerySchema, request).after) // 404 unless a party
  await markThreadNoticesSeen(tx, user!.id, params.id!) // reading the chat clears its "new message" notices, also those beyond /me's newest 20
  return Response.json({ docs })
})

export const POST = appRequest({ auth: 'required', maxBodyBytes: 16_384 }, async ({ tx, user, request, params, afterCommit }) => {
  const input = await parseBody(MessageInputSchema, request)
  return Response.json(await sendMessage(tx, user!.id, params.id!, input, afterCommit), { status: 201 })
})
