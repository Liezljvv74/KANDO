import { db, type Tx } from '@kando/db'
import { describeError, isCrossSiteWrite, type AfterCommit, type RouteHandler, type StaffRole, type StaffUser } from '@kando/domain'
import { requireStaff } from './require-staff'

type Role = StaffRole | 'any'
type Handler = (ctx: { tx: Tx; staff: StaffUser; request: Request; params: Record<string, string>; afterCommit: AfterCommit }) => Promise<Response>

/**
 * Wrapper for every /api/admin route: staff check first (401/403, nothing runs without it), then the handler in one
 * transaction on the owner connection (staff-only columns are written here, not as app_user). `role` may depend on
 * the route params and method (the generic `[resource]` routes). Every successful non-GET request leaves one audit line.
 */
export function adminRequest(role: Role | ((params: Record<string, string>, method: string) => Role), handler: Handler): RouteHandler {
  return async (request, ctx) => {
    const requestId = crypto.randomUUID()
    try {
      if (isCrossSiteWrite(request)) return Response.json({ error: 'Forbidden' }, { status: 403 }) // a write from another site
      const params = await ctx.params
      const staff = await requireStaff(typeof role === 'function' ? role(params, request.method) : role)
      const queue: (() => Promise<void>)[] = []
      const response = await db.transaction((tx) => handler({ tx, staff, request, params, afterCommit: (fn) => void queue.push(fn) }))
      // Audit trail: one line per successful staff write, ids only (no bodies, no personal data); read in the Vercel logs.
      if (request.method !== 'GET' && response.status < 400) {
        console.log(JSON.stringify({ audit: 'staff-action', time: new Date().toISOString(), staffId: staff.id, method: request.method, path: new URL(request.url).pathname, targetId: params.id ?? null }))
      }
      for (const fn of queue) await Promise.resolve().then(fn).catch((e) => console.error(`[admin-request ${requestId}] after-commit task failed ${describeError(e)}`))
      return response
    } catch (error) {
      // A thrown Response (401/403 from requireStaff, 400/409 from the domain) is the answer, as is; the transaction rolled back.
      if (error instanceof Response) return error
      console.error(`[admin-request ${requestId}] ${request.method} ${new URL(request.url).pathname} ${describeError(error)}`)
      return Response.json({ error: 'Server error' }, { status: 500 })
    }
  }
}
