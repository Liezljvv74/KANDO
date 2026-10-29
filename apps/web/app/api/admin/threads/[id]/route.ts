import { logStaffThreadAccess, staffThread, threadReadReason } from '@kando/domain'
import { adminRequest } from '../../../../../lib/admin-request'

// A Reviewer may read a reported thread. Every attempt, allowed or denied, is a staff_access_log row (GET requests leave
// no audit line otherwise) plus a console line: ids only, no text.
export const GET = adminRequest('reviewer', async ({ tx, staff, params }) => {
  const id = params.id!
  await logStaffThreadAccess(staff.id, id, await threadReadReason(tx, id))
  const messages = await staffThread(tx, id)
  console.log(JSON.stringify({ audit: 'staff-thread-read', time: new Date().toISOString(), staffId: staff.id, threadId: id }))
  return Response.json({ data: messages })
})
