import { markThreadNoticesSeen } from '@kando/domain'
import { appRequest } from '../../../../../../lib/app-request'

/** POST /threads/[id]/seen: the chat was opened (or got a new message while open): the caller's own "new message" notices of it turn seen, also those beyond /me's newest 20. 404 unless a party. */
export const POST = appRequest({ auth: 'required' }, async ({ tx, user, params }) => {
  await markThreadNoticesSeen(tx, user!.id, params.id!)
  return new Response(null, { status: 204 })
})
