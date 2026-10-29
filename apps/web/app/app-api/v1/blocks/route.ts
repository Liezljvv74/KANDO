import { BlockInputSchema, parseBody, parseQuery } from '@kando/contract'
import { blockUser, listBlocks, unblockUser } from '@kando/domain'
import { appRequest } from '../../../../lib/app-request'

export const GET = appRequest({ auth: 'required' }, async ({ tx, user }) => Response.json({ docs: await listBlocks(tx, user!.id) }))

export const POST = appRequest({ auth: 'required', maxBodyBytes: 1024 }, async ({ tx, user, request }) => {
  await blockUser(tx, user!.id, (await parseBody(BlockInputSchema, request)).threadId)
  return new Response(null, { status: 204 })
})

/** DELETE /blocks?threadId=: lifts the caller's own block of the other side of that thread. */
export const DELETE = appRequest({ auth: 'required' }, async ({ tx, user, request }) => {
  await unblockUser(tx, user!.id, parseQuery(BlockInputSchema, request).threadId)
  return new Response(null, { status: 204 })
})
