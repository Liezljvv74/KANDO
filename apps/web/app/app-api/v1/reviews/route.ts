import { parseBody, WriteReviewSchema } from '@kando/contract'
import { listMyReviews, writeReview } from '@kando/domain'
import { appRequest } from '../../../../lib/app-request'
import { refreshPublicPages } from '../../../../lib/public-cache'

/** The caller's reviews: those they wrote, and those about them once shown. */
export const GET = appRequest({ auth: 'required' }, async ({ tx, user }) => Response.json({ docs: await listMyReviews(tx, user!.id) }))

/** A review of the other side of a completed booking (body WriteReviewSchema). Not while suspended. */
export const POST = appRequest({ auth: 'required', maxBodyBytes: 16_384 }, async ({ tx, user, request }) => {
  const { bookingId, ...input } = await parseBody(WriteReviewSchema, request)
  const review = await writeReview(tx, user!.id, bookingId, input)
  refreshPublicPages('providers') // the second review of a booking reveals both on the provider page
  return Response.json(review, { status: 201 })
})
