import { unwatchProvider, watchProvider } from '@kando/domain'
import { appRequest } from '../../../../../../lib/app-request'

/** "Notify me when available" on a provider that cannot be booked yet; 204. */
export const POST = appRequest({ auth: 'required' }, async ({ tx, user, params }) => {
  await watchProvider(tx, user!.id, params.slug!)
  return new Response(null, { status: 204 })
})

/** Stop the notice; 204 also when there was none. */
export const DELETE = appRequest({ auth: 'required' }, async ({ tx, user, params }) => {
  await unwatchProvider(tx, user!.id, params.slug!)
  return new Response(null, { status: 204 })
})
