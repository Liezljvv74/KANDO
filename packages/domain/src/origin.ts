/**
 * True for a write (not GET/HEAD) that a browser sent from another site: an Origin header whose origin is neither the
 * request's own nor the configured site address. The phone app sends no Origin and is never refused.
 */
export function isCrossSiteWrite(request: Request): boolean {
  if (request.method === 'GET' || request.method === 'HEAD') return false
  const origin = request.headers.get('origin')
  if (!origin) return false
  const own = new Set([new URL(request.url).origin])
  try {
    if (process.env.NEXT_PUBLIC_SERVER_URL) own.add(new URL(process.env.NEXT_PUBLIC_SERVER_URL).origin)
  } catch {
    // a malformed setting only means one address fewer
  }
  return !own.has(origin)
}
