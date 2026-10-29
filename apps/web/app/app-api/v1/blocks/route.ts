import { BlockInputSchema, parseBody } from '@kando/contract'
import { blockUser, listBlocks } from '@kando/domain'
import { appRequest } from '../../../../lib/app-request'

export const GET = appRequest({ auth: 'required' }, async ({ tx, user }) => Response.json({ docs: await listBlocks(tx, user!.id) }))

export const POST = appRequest({ auth: 'required', maxBodyBytes: 1024 }, async ({ tx, user, request }) => {
  await blockUser(tx, user!.id, (await parseBody(BlockInputSchema, request)).userId)
  return new Response(null, { status: 204 })
})
