import { DocumentReviewInputSchema, parseBody } from '@kando/contract'
import { reviewDocument } from '@kando/domain'
import { adminRequest } from '../../../../../../lib/admin-request'

export const POST = adminRequest('reviewer', async ({ tx, staff, request, params, afterCommit }) =>
  reviewDocument(tx, staff, params.id!, await parseBody(DocumentReviewInputSchema, request), afterCommit),
)
