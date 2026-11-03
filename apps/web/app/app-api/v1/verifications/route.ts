import { DocumentInputSchema, DocumentsListSchema, parseBody } from '@kando/contract'
import { listDocuments, submitDocument } from '@kando/domain'
import { appRequest } from '../../../../lib/app-request'
import { refreshPublicPages } from '../../../../lib/public-cache'

// The AI check of a new document runs after the answer is sent, inside this function's time.
export const maxDuration = 60

export const GET = appRequest({ auth: 'required' }, async ({ tx, user }) =>
  Response.json(DocumentsListSchema.parse({ docs: await listDocuments(tx, user!.id) })),
)

export const POST = appRequest({ auth: 'required', maxBodyBytes: 16_384 }, async ({ tx, user, request, afterCommit }) => {
  const input = await parseBody(DocumentInputSchema, request)
  const result = await submitDocument(tx, user!.id, input.requirement, input.document, afterCommit, () => refreshPublicPages('providers'))
  return result instanceof Response ? result : Response.json(result, { status: 201 })
})
