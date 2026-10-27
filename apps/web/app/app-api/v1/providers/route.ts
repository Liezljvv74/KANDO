import { parseQuery, SearchQuerySchema } from '@kando/contract'
import { search } from '@kando/domain'
import { appRequest } from '../../../../lib/app-request'

export const GET = appRequest({ auth: 'optional' }, async ({ tx, request }) =>
  Response.json(await search(tx, parseQuery(SearchQuerySchema, request))),
)
