import { parseQuery, TranslationQuerySchema } from '@kando/contract'
import { clientKeyOf, getPublicProfile, textsOf, translateTexts, TranslationUnavailable } from '@kando/domain'
import { appRequest } from '../../../../../../lib/app-request'

// Only the slug and lang are read: the texts come from the stored profile, never from the client.
export const GET = appRequest({ auth: 'optional' }, async ({ tx, user, request, params }) => {
  const { lang } = parseQuery(TranslationQuerySchema, request)
  const profile = await getPublicProfile(tx, params.slug!, lang)
  if (!profile) return Response.json({ error: 'Not found' }, { status: 404 })
  try {
    return Response.json(await translateTexts(tx, textsOf(profile), lang, clientKeyOf(user, request)))
  } catch (e) {
    // Returned, not re-thrown: the request transaction commits and keeps the rate-limit counter.
    if (e instanceof TranslationUnavailable) return Response.json({ error: 'Translation unavailable' }, { status: 503 })
    throw e
  }
})
