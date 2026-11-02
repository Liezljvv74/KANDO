import { DirectBookingInputSchema, ListQuerySchema, parseBody, parseQuery } from '@kando/contract'
import { createDirectBooking, listBookings } from '@kando/domain'
import { appRequest } from '../../../../lib/app-request'

export const GET = appRequest({ auth: 'required' }, async ({ tx, user, request }) => {
  const { role, cursor } = parseQuery(ListQuerySchema, request)
  return Response.json(await listBookings(tx, user!.id, role, cursor))
})

/**
 * Direct booking (a time proposed for a fixed-price service, no request). The app no longer uses it since the one request flow
 * (MVP plan step 1.6). Nobody is using the app yet, so no old build needs it: it goes in the clean-up of the proposed path (step 1.6b).
 */
export const POST = appRequest({ auth: 'required', maxBodyBytes: 16_384 }, async ({ tx, user, request, afterCommit }) => {
  const input = await parseBody(DirectBookingInputSchema, request)
  return Response.json(await createDirectBooking(tx, user!.id, input, new Date(), afterCommit), { status: 201 })
})
