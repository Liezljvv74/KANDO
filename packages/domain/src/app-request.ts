import { asUser, type Tx } from '@kando/db'
import { EmailConflictError, ensureUser, type SessionUser } from './users'

export type RouteHandler = (request: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>
export type SessionResolver = (request: Request) => Promise<{ id: string; email: string } | null>
type Opts<P> = {
  auth: 'required' | 'optional'
  maxBodyBytes?: number
  /** Reads and checks the body (an upload) after the session and size checks, before the transaction opens. */
  prepare?: (request: Request) => Promise<P>
}
type Handler<P> = (ctx: {
  tx: Tx
  user: SessionUser | null
  request: Request
  params: Record<string, string>
  prepared: P
}) => Promise<Response>

/**
 * Builds the app request wrapper around a session source (the web app passes the Neon Auth one):
 * session check, body-size limit, first-contact users row, one transaction as app_user, rollback on error.
 */
export function createAppRequest(getSession: SessionResolver) {
  return <P = undefined>(opts: Opts<P>, handler: Handler<P>): RouteHandler =>
    async (request, ctx) => {
      const requestId = crypto.randomUUID()
      try {
        const session = await getSession(request)
        if (!session && opts.auth === 'required') return Response.json({ error: 'Unauthorized' }, { status: 401 })
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
        const params = await ctx.params
        return await asUser(user?.id ?? null, (tx) => handler({ tx, user, request, params, prepared }))
      } catch (error) {
        // A Response thrown by a handler (parseBody/parseQuery: 400) is the answer, as is.
        if (error instanceof Response) return error
        if (error instanceof EmailConflictError) {
          console.error(`[app-request ${requestId}] email conflict`)
          return Response.json({ error: error.message }, { status: 409 })
        }
        console.error(`[app-request ${requestId}] ${request.method} ${new URL(request.url).pathname}`, error)
        return Response.json({ error: 'Server error' }, { status: 500 })
      }
    }
}
