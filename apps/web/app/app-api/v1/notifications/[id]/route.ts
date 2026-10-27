import { NotificationPatchSchema, parseBody } from '@kando/contract'
import { markNotification } from '@kando/domain'
import { appRequest } from '../../../../../lib/app-request'

export const PATCH = appRequest({ auth: 'required', maxBodyBytes: 1024 }, async ({ tx, user, request, params }) =>
  (await markNotification(tx, user!.id, params.id!, await parseBody(NotificationPatchSchema, request)))
    ? new Response(null, { status: 204 })
    : Response.json({ error: 'Not found' }, { status: 404 }),
)
