import { parseBody, SuspendInputSchema } from '@kando/contract'
import { notifySuspension, suspendUser } from '@kando/domain'
import { adminRequest } from '../../../../../../lib/admin-request'

export const POST = adminRequest('admin', async ({ tx, staff, request, params, afterCommit }) => {
  const input = await parseBody(SuspendInputSchema, request)
  const res = await suspendUser(tx, staff, params.id!, input)
  if (res.ok) afterCommit(() => notifySuspension(params.id!, { until: input.until ? new Date(input.until) : null, reason: input.reason }))
  return res
})
