import { asUser, type Tx } from '@kando/db'
import { describeError } from './log-error'
import { isCrossSiteWrite } from './origin'
import { EmailConflictError, ensureUser, SessionGoneError, type SessionUser } from './users'

export type RouteHandler = (request: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>
/** The signed-in account as the auth server knows it; `name` is the account name given at sign-up. */
export type Session = { id: string; email: string; emailVerified: boolean; name?: string }
export type SessionResolver = (request: Request) => Promise<Session | null>
export type AfterCommit = (fn: () => Promise<void>) => void
type Opts<P> = {
  auth: 'required' | 'optional'
  maxBodyBytes?: number
  /** Reads and checks the body (an upload) after the session and size checks, before the transaction opens. */
  prepare?: (request: Request) => Promise<P>
  /** A suspended person may still call this route (taking their own profile offline). DELETE is always allowed. */
  allowWhenSuspended?: boolean
}
type Handler<P> = (ctx: {
  tx: Tx
  user: SessionUser | null
  request: Request
  params: Record<string, string>
  prepared: P
  /** Queues work (storage deletes) that must only happen once the transaction has committed. */
  afterCommit: AfterCommit
}) => Promise<Response>

/**
 * Builds the app request wrapper around a session source (the web app passes the Neon Auth one):
 * session check, body-size limit, first-contact users row, one transaction as app_user, rollback on error.
 * An unconfirmed email is refused (403 EMAIL_NOT_VERIFIED) where auth is required and counts as signed out where it
 * is optional: it never gets a users row. A suspended person (users.suspended_until in the future) gets 403 SUSPENDED
 * on every create or edit (POST, PUT, PATCH); reads and DELETE (erasing their own data) still work.
 */
export function createAppRequest(getSession: SessionResolver) {
  return <P = undefined>(opts: Opts<P>, handler: Handler<P>): RouteHandler =>
    async (request, ctx) => {
      const requestId = crypto.randomUUID()
      try {
        if (isCrossSiteWrite(request)) return Response.json({ error: 'Forbidden' }, { status: 403 })
        const found = await getSession(request)
        if (!found && opts.auth === 'required') return Response.json({ error: 'Unauthorized' }, { status: 401 })
        if (found && !found.emailVerified && opts.auth === 'required') {
          return Response.json({ error: 'EMAIL_NOT_VERIFIED' }, { status: 403 })
        }
        const session = found?.emailVerified ? found : null
        if (opts.maxBodyBytes !== undefined) {
          const declared = Number(request.headers.get('content-length') ?? 0)
          if (declared > opts.maxBodyBytes) return Response.json({ error: 'Payload too large' }, { status: 413 })
          // Content-Length can be absent or wrong: count the real bytes on a clone, still before the handler.
          if (request.body && (await request.clone().arrayBuffer()).byteLength > opts.maxBodyBytes) {
            return Response.json({ error: 'Payload too large' }, { status: 413 })
          }
        }
        const prepared = (opts.prepare ? await opts.prepare(request) : undefined) as P
        const user = session ? await ensureUser(session, request) : null
        // A suspended person can still read (GET) and erase their own data (DELETE), never create or edit; an expired date counts as not suspended.
        if (user?.suspendedUntil && user.suspendedUntil > new Date() && !['GET', 'DELETE'].includes(request.method) && !opts.allowWhenSuspended) {
          return Response.json({ error: 'SUSPENDED' }, { status: 403 })
        }
        const params = await ctx.params
        const queue: (() => Promise<void>)[] = []
        const afterCommit: AfterCommit = (fn) => void queue.push(fn)
        const response = await asUser(user?.id ?? null, (tx) => handler({ tx, user, request, params, prepared, afterCommit }))
        // The transaction has committed: only now touch storage. A failing task is logged, never turns the answer into a 500.
        for (const fn of queue) await fn().catch((e) => console.error(`[app-request ${requestId}] after-commit task failed ${describeError(e)}`))
        return response
      } catch (error) {
        // A Response thrown by a handler (parseBody/parseQuery: 400) is the answer, as is.
        if (error instanceof Response) return error
        if (error instanceof SessionGoneError) return Response.json({ error: 'Unauthorized' }, { status: 401 })
        if (error instanceof EmailConflictError) {
          console.error(`[app-request ${requestId}] email conflict`)
          return Response.json({ error: error.message }, { status: 409 })
        }
        console.error(`[app-request ${requestId}] ${request.method} ${new URL(request.url).pathname} ${describeError(error)}`)
        return Response.json({ error: 'Server error' }, { status: 500 })
      }
    }
}
