import { parseQuery, TranslationQuerySchema } from '@kando/contract'
import { db } from '@kando/db'
import { clientKeyOf, getPublicProfile, textsOf, translateTexts, TranslationUnavailable } from '@kando/domain'
import { appRequest } from '../../../../../../lib/app-request'

const unavailable = () => Response.json({ error: 'Translation unavailable' }, { status: 503 })

// Only the slug and lang are read: the texts come from the stored profile, never from the client.
// The model call and the rate-limit counter run after the request transaction, on the owner connection.
export const GET = appRequest({ auth: 'optional' }, async ({ tx, user, request, params }) => {
  const { lang } = parseQuery(TranslationQuerySchema, request)
  const profile = await getPublicProfile(tx, params.slug!, lang)
  if (!profile) return Response.json({ error: 'Not found' }, { status: 404 })
  let clientKey: string
  try {
    clientKey = clientKeyOf(user, request.headers) // throws TranslationUnavailable without a usable secret
  } catch (e) {
    if (e instanceof TranslationUnavailable) return unavailable()
    throw e
  }
  const texts = textsOf(profile)
  return async () => {
    try {
      return Response.json(await translateTexts(db, texts, lang, clientKey))
    } catch (e) {
      if (e instanceof TranslationUnavailable) return unavailable()
      throw e
    }
  }
})
