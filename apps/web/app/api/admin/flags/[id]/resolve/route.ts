import { resolveFlag } from '@kando/domain'
import { adminRequest } from '../../../../../../lib/admin-request'

export const POST = adminRequest('admin', async ({ tx, staff, params }) => resolveFlag(tx, staff.id, params.id!))
