import { db } from '@kando/db'
import { paymentsEnabled, payoutStatus } from '@kando/domain'
import { appRequest } from '../../../../../lib/app-request'
import { refreshPublicPages } from '../../../../../lib/public-cache'

/** Whether the caller's payout set-up is complete (PayoutStatusSchema); 503 PAYMENTS_OFF while payments are off. */
export const GET = appRequest({ auth: 'required' }, async ({ user }) =>
  paymentsEnabled() ? () => payoutStatus(db, user!.id).then(({ ready, changed }) => (changed && refreshPublicPages('providers'), Response.json({ ready }))) : Response.json({ error: 'PAYMENTS_OFF' }, { status: 503 }),
)
