/**
 * True for a write (not GET/HEAD) that may come from another site: an Origin header whose origin is neither the
 * request's own nor the configured site address, or a Cookie with no Origin at all (browsers send Origin on every
 * write, and the phone app sends the API's own origin). A write with neither cookie nor Origin carries nothing to abuse.
 */
export function isCrossSiteWrite(request: Request): boolean {
  if (request.method === 'GET' || request.method === 'HEAD') return false
  const origin = request.headers.get('origin')
  if (!origin) return request.headers.has('cookie')
  const own = new Set([new URL(request.url).origin])
  try {
    if (process.env.NEXT_PUBLIC_SERVER_URL) own.add(new URL(process.env.NEXT_PUBLIC_SERVER_URL).origin)
  } catch {
    // a malformed setting only means one address fewer
  }
  return !own.has(origin)
}
