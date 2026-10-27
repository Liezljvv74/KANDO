import { parseBody, SuspendInputSchema } from '@kando/contract'
import { suspendUser } from '@kando/domain'
import { adminRequest } from '../../../../../../lib/admin-request'

export const POST = adminRequest('admin', async ({ tx, staff, request, params }) =>
  suspendUser(tx, staff, params.id!, await parseBody(SuspendInputSchema, request)),
)
