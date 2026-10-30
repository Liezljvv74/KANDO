import { paymentsEnabled, payoutStatus } from '@kando/domain'
import { appRequest } from '../../../../../lib/app-request'

/** Whether the caller's payout set-up is complete (PayoutStatusSchema); 503 PAYMENTS_OFF while payments are off. */
export const GET = appRequest({ auth: 'required' }, async ({ tx, user }) =>
  paymentsEnabled() ? Response.json(await payoutStatus(tx, user!.id)) : Response.json({ error: 'PAYMENTS_OFF' }, { status: 503 }),
)
