import { parseBody, PushSettingsPatchSchema } from '@kando/contract'
import { getPushSettings, setPushSettings } from '@kando/domain'
import { appRequest } from '../../../../../lib/app-request'

export const GET = appRequest({ auth: 'required' }, async ({ tx, user }) => Response.json(await getPushSettings(tx, user!.id)))

export const PATCH = appRequest({ auth: 'required', maxBodyBytes: 1024 }, async ({ tx, user, request }) =>
  Response.json(await setPushSettings(tx, user!.id, await parseBody(PushSettingsPatchSchema, request))),
)
