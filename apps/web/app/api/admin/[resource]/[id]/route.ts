import { adminGet, adminRemove, adminUpdate, roleFor } from '@kando/domain'
import { adminRequest } from '../../../../../lib/admin-request'

export const GET = adminRequest(roleFor, async ({ tx, staff, params }) => adminGet(tx, params.resource!, params.id!, staff.id))
export const PATCH = adminRequest(roleFor, async ({ tx, request, params }) => adminUpdate(tx, params.resource!, params.id!, request))
export const DELETE = adminRequest(roleFor, async ({ tx, params, afterCommit }) => adminRemove(tx, params.resource!, params.id!, afterCommit))
