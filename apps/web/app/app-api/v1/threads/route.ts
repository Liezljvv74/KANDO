import { listThreads } from '@kando/domain'
import { appRequest } from '../../../../lib/app-request'

export const GET = appRequest({ auth: 'required' }, async ({ tx, user }) => Response.json({ docs: await listThreads(tx, user!.id) }))
