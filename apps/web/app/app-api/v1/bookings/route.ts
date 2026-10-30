import { DirectBookingInputSchema, ListQuerySchema, parseBody, parseQuery } from '@kando/contract'
import { createDirectBooking, listBookings } from '@kando/domain'
import { appRequest } from '../../../../lib/app-request'

export const GET = appRequest({ auth: 'required' }, async ({ tx, user, request }) => {
  const { role, cursor } = parseQuery(ListQuerySchema, request)
  return Response.json(await listBookings(tx, user!.id, role, cursor))
})

export const POST = appRequest({ auth: 'required', maxBodyBytes: 16_384 }, async ({ tx, user, request, afterCommit }) => {
  const input = await parseBody(DirectBookingInputSchema, request)
  return Response.json(await createDirectBooking(tx, user!.id, input, new Date(), afterCommit), { status: 201 })
})
