import { parseBody, ReviewInputSchema } from '@kando/contract'
import { editReview } from '@kando/domain'
import { appRequest } from '../../../../../lib/app-request'

/** Its author changes the stars or text, for 14 days after writing. Not while suspended. */
export const PATCH = appRequest({ auth: 'required', maxBodyBytes: 16_384 }, async ({ tx, user, request, params }) => {
  const input = await parseBody(ReviewInputSchema, request)
  return Response.json(await editReview(tx, user!.id, params.id!, input))
})
