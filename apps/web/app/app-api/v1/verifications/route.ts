import { DocumentInputSchema, DocumentsListSchema, parseBody } from '@kando/contract'
import { listDocuments, submitDocument } from '@kando/domain'
import { appRequest } from '../../../../lib/app-request'

export const GET = appRequest({ auth: 'required' }, async ({ tx, user }) =>
  Response.json(DocumentsListSchema.parse({ docs: await listDocuments(tx, user!.id) })),
)

export const POST = appRequest({ auth: 'required', maxBodyBytes: 16_384 }, async ({ tx, user, request }) => {
  const input = await parseBody(DocumentInputSchema, request)
  const result = await submitDocument(tx, user!.id, input.requirement, input.document)
  return result instanceof Response ? result : Response.json(result, { status: 201 })
})
