import { AgreedTimeInputSchema, parseBody } from '@kando/contract'
import { proposeAgreedTime } from '@kando/domain'
import { appRequest } from '../../../../../../lib/app-request'

export const POST = appRequest({ auth: 'required', maxBodyBytes: 16_384 }, async ({ tx, user, request, params, afterCommit }) =>
  Response.json(await proposeAgreedTime(tx, user!.id, params.id!, await parseBody(AgreedTimeInputSchema, request), new Date(), afterCommit)),
)
