import { parseBody, ReportInputSchema } from '@kando/contract'
import { reportMessage } from '@kando/domain'
import { appRequest } from '../../../../../../lib/app-request'

export const POST = appRequest({ auth: 'required', maxBodyBytes: 4096 }, async ({ tx, user, request, params }) => {
  await reportMessage(tx, user!.id, params.id!, await parseBody(ReportInputSchema, request))
  return new Response(null, { status: 204 })
})
