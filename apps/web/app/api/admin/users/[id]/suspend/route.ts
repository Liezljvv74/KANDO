import { parseBody, SuspendInputSchema } from '@kando/contract'
import { suspendUser } from '@kando/domain'
import { adminRequest } from '../../../../../../lib/admin-request'
import { refreshPublicPages } from '../../../../../../lib/public-cache'

export const POST = adminRequest('admin', async ({ tx, staff, request, params, afterCommit }) => {
  const input = await parseBody(SuspendInputSchema, request)
  const answer = await suspendUser(tx, staff, params.id!, input, afterCommit)
  refreshPublicPages('providers')
  return answer
})
