import { staffThread } from '@kando/domain'
import { adminRequest } from '../../../../../lib/admin-request'

// A Reviewer may read a reported thread. The read itself is logged (GET requests leave no audit line otherwise): ids only, no text.
export const GET = adminRequest('reviewer', async ({ tx, staff, params }) => {
  const messages = await staffThread(tx, params.id!)
  console.log(JSON.stringify({ audit: 'staff-thread-read', time: new Date().toISOString(), staffId: staff.id, threadId: params.id }))
  return Response.json({ data: messages })
})
