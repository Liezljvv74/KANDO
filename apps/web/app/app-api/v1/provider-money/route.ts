import { ProviderMoneyQuerySchema, parseQuery } from '@kando/contract'
import { db } from '@kando/db'
import { ownProvider, providerMoney } from '@kando/domain'
import { appRequest } from '@/lib/app-request'

/** The provider's money strip (ProviderMoneySchema): net amounts, read on the owner connection after the own-provider check; 403 for a customer-only account. */
export const GET = appRequest({ auth: 'required' }, async ({ tx, user, request }) => {
  const q = parseQuery(ProviderMoneyQuerySchema, request)
  const own = await ownProvider(tx, user!.id)
  if (!own) return Response.json({ error: 'Forbidden' }, { status: 403 })
  return () => providerMoney(db, own.id, new Date(), q.from && q.to ? { from: new Date(q.from), to: new Date(q.to) } : undefined).then((m) => Response.json(m))
})
