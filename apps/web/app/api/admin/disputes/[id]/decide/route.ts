import { db } from '@kando/db'
import { DisputeDecisionSchema, parseBody } from '@kando/contract'
import { decideDispute } from '@kando/domain'
import { adminRequest } from '../../../../../../lib/admin-request'

// Administrator only. The decision and its money step run in their own owner-connection transactions (db), not in the
// request's: a decision is kept even when the payout after it fails (the timer retries it).
export const POST = adminRequest('admin', async ({ staff, request, params }) => {
  const input = await parseBody(DisputeDecisionSchema, request)
  return Response.json({ data: await decideDispute(db, staff.id, params.id!, input) })
})
