import { BookingAnswerSchema, parseBody } from '@kando/contract'
import { answerBooking } from '@kando/domain'
import { appRequest } from '../../../../../../lib/app-request'

export const POST = appRequest({ auth: 'required', maxBodyBytes: 4_096 }, async ({ tx, user, request, params, afterCommit }) => {
  const answer = await parseBody(BookingAnswerSchema, request)
  return Response.json(await answerBooking(tx, user!.id, params.id!, answer, new Date(), afterCommit))
})
