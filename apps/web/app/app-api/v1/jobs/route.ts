import { JobsQuerySchema, parseQuery } from '@kando/contract'
import { listJobs } from '@kando/domain'
import { appRequest } from '@/lib/app-request'

export const GET = appRequest({ auth: 'required' }, async ({ tx, user, request }) => {
  const { role, section, q, cursor } = parseQuery(JobsQuerySchema, request)
  return Response.json(await listJobs(tx, user!.id, { role, section, search: q, cursor }))
})
