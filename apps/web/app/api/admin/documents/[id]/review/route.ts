import { DocumentReviewInputSchema, parseBody } from '@kando/contract'
import { reviewDocument } from '@kando/domain'
import { adminRequest } from '../../../../../../lib/admin-request'
import { refreshPublicPages } from '../../../../../../lib/public-cache'

export const POST = adminRequest('reviewer', async ({ tx, staff, request, params, afterCommit }) => {
  const answer = await reviewDocument(tx, staff, params.id!, await parseBody(DocumentReviewInputSchema, request), afterCommit)
  refreshPublicPages('providers') // an approved or rejected document can show or hide a provider
  return answer
})
