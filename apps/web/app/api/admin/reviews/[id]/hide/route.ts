import { parseBody, ReviewHideSchema } from '@kando/contract'
import { hideReview } from '@kando/domain'
import { adminRequest } from '../../../../../../lib/admin-request'
import { refreshPublicPages } from '../../../../../../lib/public-cache'

// Administrator only: hide a review that breaks the rules, or show it again (with a reason either way).
export const POST = adminRequest('admin', async ({ tx, staff, request, params }) => {
  const data = await hideReview(tx, staff.id, params.id!, await parseBody(ReviewHideSchema, request))
  refreshPublicPages('providers')
  return Response.json({ data })
})
