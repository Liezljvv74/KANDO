import { BusyQuerySchema, parseQuery } from '@kando/contract'
import { busyTimes } from '@kando/domain'
import { appRequest } from '../../../../../../lib/app-request'

export const GET = appRequest({ auth: 'optional' }, async ({ tx, request, params }) => {
  const { from, to } = parseQuery(BusyQuerySchema, request)
  return Response.json({ docs: await busyTimes(tx, params.slug!, from, to) })
})
