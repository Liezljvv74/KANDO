import { createPayLink, paymentsEnabled } from '@kando/domain'
import { appRequest } from '../../../../../../lib/app-request'

/** The customer's pay link (PayLinkSchema); 503 PAYMENTS_OFF while payments are off. */
export const POST = appRequest({ auth: 'required' }, async ({ tx, user, params }) =>
  paymentsEnabled() ? Response.json(await createPayLink(tx, user!.id, params.id!)) : Response.json({ error: 'PAYMENTS_OFF' }, { status: 503 }),
)
