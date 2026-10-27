import { LangQuerySchema, parseQuery } from '@kando/contract'
import { getPublicProfile } from '@kando/domain'
import { appRequest } from '../../../../../lib/app-request'

export const GET = appRequest({ auth: 'optional' }, async ({ tx, request, params }) => {
  const { lang } = parseQuery(LangQuerySchema, request)
  const profile = await getPublicProfile(tx, params.slug!, lang)
  return profile ? Response.json(profile) : Response.json({ error: 'Not found' }, { status: 404 })
})
