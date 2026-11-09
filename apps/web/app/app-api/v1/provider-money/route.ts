import { db } from '@kando/db'
import { ownProvider, providerMoney } from '@kando/domain'
import { appRequest } from '../../../../lib/app-request'

/** The provider's money strip (ProviderMoneySchema): net amounts, read on the owner connection after the own-provider check; 403 for a customer-only account. */
export const GET = appRequest({ auth: 'required' }, async ({ tx, user }) => {
  const own = await ownProvider(tx, user!.id)
  if (!own) return Response.json({ error: 'Forbidden' }, { status: 403 })
  return () => providerMoney(db, own.id, new Date()).then((m) => Response.json(m))
})
