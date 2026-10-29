import { DirectBookingInputSchema, parseBody } from '@kando/contract'
import { createDirectBooking, listBookings } from '@kando/domain'
import { appRequest } from '../../../../lib/app-request'

export const GET = appRequest({ auth: 'required' }, async ({ tx, user, request }) => {
  const role = new URL(request.url).searchParams.get('role') === 'provider' ? 'provider' : 'customer'
  return Response.json({ docs: await listBookings(tx, user!.id, role) })
})

export const POST = appRequest({ auth: 'required', maxBodyBytes: 16_384 }, async ({ tx, user, request }) => {
  const input = await parseBody(DirectBookingInputSchema, request)
  return Response.json(await createDirectBooking(tx, user!.id, input), { status: 201 })
})
