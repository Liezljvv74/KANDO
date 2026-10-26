import { LangSchema } from '@kando/contract'
import { listCategories } from '@kando/domain'
import { appRequest } from '../../../../lib/app-request'

export const GET = appRequest({ auth: 'optional' }, async ({ tx, request }) => {
  const lang = LangSchema.safeParse(new URL(request.url).searchParams.get('lang') ?? 'de')
  if (!lang.success) return Response.json({ error: 'Unknown language' }, { status: 400 })
  return Response.json(await listCategories(tx, lang.data))
})
