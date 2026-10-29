import { db } from '@kando/db'
import { BadSignatureError, describeError, flagForStaff, gateway, handleGatewayEvent, paymentsEnabled, type GatewayEvent } from '@kando/domain'

// Stripe events are a few kilobytes; anything far larger is not one.
const MAX_BYTES = 256 * 1024

/**
 * Stripe's webhook: server to server, no session and no Origin header, so not wrapped in appRequest (nothing for the
 * cross-site guard to check: the signature is the authentication). The raw body is verified as received. 404 while
 * payments are off; 400 on a missing or wrong signature; 200 once handled (also for events we ignore, live-mode ones
 * included, see stripe-gateway.ts); 500 on any error, so Stripe delivers again. Never logs the body or the signature.
 */
export async function POST(request: Request): Promise<Response> {
  if (!paymentsEnabled()) return Response.json({ error: 'Not found' }, { status: 404 })
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BYTES) return Response.json({ error: 'Payload too large' }, { status: 413 })
  const body = await request.text()
  if (Buffer.byteLength(body) > MAX_BYTES) return Response.json({ error: 'Payload too large' }, { status: 413 })
  let event: GatewayEvent
  try {
    event = gateway().verifyEvent(body, request.headers.get('stripe-signature') ?? '')
  } catch (e) {
    if (e instanceof BadSignatureError) return Response.json({ error: 'Bad signature' }, { status: 400 })
    console.error(`[stripe-webhook] unreadable event ${describeError(e)}`)
    return Response.json({ error: 'Server error' }, { status: 500 })
  }
  try {
    await handleGatewayEvent(event)
    return Response.json({ received: true })
  } catch (e) {
    console.error(`[stripe-webhook] ${event.type} ${event.id} failed ${describeError(e)}`)
    // A payment we could not process (until a retry succeeds) must not go unseen: Stripe stops retrying after 3 days.
    // Own owner-connection insert, outside the rolled-back transaction; one open flag per booking.
    if (event.type === 'checkout-paid') {
      await flagForStaff(db, { kind: 'payment-unprocessed', refId: event.bookingId, note: `payment ${event.paymentRef}, session ${event.sessionId}` }).catch((f) =>
        console.error(`[stripe-webhook] could not flag ${event.id} ${describeError(f)}`),
      )
    }
    return Response.json({ error: 'Server error' }, { status: 500 })
  }
}
