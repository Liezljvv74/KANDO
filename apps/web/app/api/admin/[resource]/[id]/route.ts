import { adminGet, adminRemove, adminUpdate, roleFor } from '@kando/domain'
import { adminRequest } from '../../../../../lib/admin-request'
import { refreshAfterAdminChange } from '../../../../../lib/public-cache'

export const GET = adminRequest(roleFor, async ({ tx, staff, params }) => adminGet(tx, params.resource!, params.id!, staff.id))
export const PATCH = adminRequest(roleFor, async ({ tx, request, params }) => {
  const answer = await adminUpdate(tx, params.resource!, params.id!, request)
  refreshAfterAdminChange(params.resource!)
  return answer
})
export const DELETE = adminRequest(roleFor, async ({ tx, params, afterCommit }) => {
  const answer = await adminRemove(tx, params.resource!, params.id!, afterCommit)
  refreshAfterAdminChange(params.resource!)
  return answer
})
