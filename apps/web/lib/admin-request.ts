import { db, type Tx } from '@kando/db'
import type { AfterCommit, RouteHandler, StaffRole, StaffUser } from '@kando/domain'
import { requireStaff } from './require-staff'

type Role = StaffRole | 'any'
type Handler = (ctx: { tx: Tx; staff: StaffUser; request: Request; params: Record<string, string>; afterCommit: AfterCommit }) => Promise<Response>

/**
 * Wrapper for every /api/admin route: staff check first (401/403, nothing runs without it), then the handler in one
 * transaction on the owner connection (staff-only columns are written here, not as app_user). `role` may depend on
 * the route params and method (the generic `[resource]` routes).
 */
export function adminRequest(role: Role | ((params: Record<string, string>, method: string) => Role), handler: Handler): RouteHandler {
  return async (request, ctx) => {
    const requestId = crypto.randomUUID()
    try {
      const params = await ctx.params
      const staff = await requireStaff(typeof role === 'function' ? role(params, request.method) : role)
      const queue: (() => Promise<void>)[] = []
      const response = await db.transaction((tx) => handler({ tx, staff, request, params, afterCommit: (fn) => void queue.push(fn) }))
      for (const fn of queue) await fn().catch((e) => console.error(`[admin-request ${requestId}] after-commit task failed`, e))
      return response
    } catch (error) {
      // A thrown Response (401/403 from requireStaff, 400/409 from the domain) is the answer, as is; the transaction rolled back.
      if (error instanceof Response) return error
      console.error(`[admin-request ${requestId}] ${request.method} ${new URL(request.url).pathname}`, error)
      return Response.json({ error: 'Server error' }, { status: 500 })
    }
  }
}
