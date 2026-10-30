import { db } from '@kando/db'
import { paymentsEnabled, startPayoutSetup } from '@kando/domain'
import { appRequest } from '../../../../../lib/app-request'

/** A fresh Stripe-hosted payout set-up link for the caller's own provider profile (PayoutSetupSchema); 503 PAYMENTS_OFF while payments are off. */
export const POST = appRequest({ auth: 'required' }, async ({ user }) =>
  paymentsEnabled() ? () => startPayoutSetup(db, user!.id).then((r) => Response.json(r)) : Response.json({ error: 'PAYMENTS_OFF' }, { status: 503 }),
)
