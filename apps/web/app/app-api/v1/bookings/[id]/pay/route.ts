import { db } from '@kando/db'
import { createPayLink, paymentsEnabled } from '@kando/domain'
import { appRequest } from '../../../../../../lib/app-request'

/** The customer's pay link (PayLinkSchema); 503 PAYMENTS_OFF while payments are off. */
export const POST = appRequest({ auth: 'required' }, async ({ user, params }) =>
  paymentsEnabled() ? () => createPayLink(db, user!.id, params.id!).then((r) => Response.json(r)) : Response.json({ error: 'PAYMENTS_OFF' }, { status: 503 }),
)
