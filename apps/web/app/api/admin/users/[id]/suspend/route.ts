import { parseBody, SuspendInputSchema } from '@kando/contract'
import { suspendUser } from '@kando/domain'
import { adminRequest } from '../../../../../../lib/admin-request'

export const POST = adminRequest('admin', async ({ tx, staff, request, params, afterCommit }) => {
  const input = await parseBody(SuspendInputSchema, request)
  return suspendUser(tx, staff, params.id!, input, afterCommit)
})
