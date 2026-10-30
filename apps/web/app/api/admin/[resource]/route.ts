import { AdminListQuerySchema, parseQuery } from '@kando/contract'
import { adminCreate, adminList, adminSetStaff, roleFor } from '@kando/domain'
import { adminRequest } from '../../../../lib/admin-request'
import { refreshAfterAdminChange } from '../../../../lib/public-cache'

export const GET = adminRequest(roleFor, async ({ tx, request, params }) => adminList(tx, params.resource!, parseQuery(AdminListQuerySchema, request)))
export const POST = adminRequest(roleFor, async ({ tx, request, params }) => {
  const answer = await adminCreate(tx, params.resource!, request)
  refreshAfterAdminChange(params.resource!)
  return answer
})
// PATCH /api/admin/staff { email, staffRole }
export const PATCH = adminRequest(roleFor, async ({ tx, request, params }) => adminSetStaff(tx, params.resource!, request))
