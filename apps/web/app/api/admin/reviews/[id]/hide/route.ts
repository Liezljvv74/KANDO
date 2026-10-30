import { parseBody, ReviewHideSchema } from '@kando/contract'
import { hideReview } from '@kando/domain'
import { adminRequest } from '../../../../../../lib/admin-request'

// Administrator only: hide a review that breaks the rules, or show it again (with a reason either way).
export const POST = adminRequest('admin', async ({ tx, staff, request, params }) =>
  Response.json({ data: await hideReview(tx, staff.id, params.id!, await parseBody(ReviewHideSchema, request)) }),
)
