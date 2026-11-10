import { LangSchema } from '@kando/contract'
import { db } from '@kando/db'
import { HelpSearchLimited, ipHashOf, MAX_QUERY_CHARS, MIN_QUERY_CHARS, searchHelp } from '@kando/domain'
import { DEFAULT_LANG } from '@kando/i18n'
import { appRequest } from '@/lib/app-request'

// Signed out is fine. Only approved topics come back, with no scores. The counter, the search and the embedding call run after the
// request transaction, on the owner connection. The searched text is never stored or logged (only a count per hashed address or user id).
export const GET = appRequest({ auth: 'optional' }, async ({ user, request }) => {
  const params = new URL(request.url).searchParams
  const lang = LangSchema.safeParse(params.get('lang') ?? DEFAULT_LANG)
  if (!lang.success) return Response.json({ error: 'Unknown language' }, { status: 400 })
  const q = (params.get('q') ?? '').trim()
  if ([...q].length < MIN_QUERY_CHARS || [...q].length > MAX_QUERY_CHARS) return Response.json({ error: `The search text must be ${MIN_QUERY_CHARS} to ${MAX_QUERY_CHARS} characters` }, { status: 400 })
  const clientKey = user ? `user:${user.id}` : `ip:${ipHashOf(request.headers)}`
  return async () => {
    try {
      return Response.json({ topics: await searchHelp(db, { q, lang: lang.data, clientKey, signedIn: !!user }) })
    } catch (e) {
      if (e instanceof HelpSearchLimited) return Response.json({ error: 'RATE_LIMITED', message: 'Too many searches. Please try again later.' }, { status: 429 })
      throw e
    }
  }
})
