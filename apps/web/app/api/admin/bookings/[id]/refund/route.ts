import { db } from '@kando/db'
import { parseBody, StaffRefundSchema } from '@kando/contract'
import { staffRefund } from '@kando/domain'
import { adminRequest } from '../../../../../../lib/admin-request'

// Administrator only; settles on the owner connection in its own transaction (db), like every other ending.
export const POST = adminRequest('admin', async ({ staff, request, params }) => {
  const input = await parseBody(StaffRefundSchema, request)
  return Response.json({ data: await staffRefund(db, staff.id, params.id!, input) })
})
