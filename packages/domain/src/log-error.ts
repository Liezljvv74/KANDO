const EMAIL = /[^\s@<>()"',;:]+@[^\s@<>()"',;]+\.[^\s@<>()"',;]+/g

// A Drizzle error message is "Failed query: <sql> params: <values>"; a Postgres detail reads "Key (col)=(value) ...".
const QUERY_AND_PARAMS = /Failed query[\s\S]*|params:[\s\S]*/
const PG_KEY_DETAIL = /Key \([\s\S]*/

const clean = (m: unknown): string => (typeof m === 'string' ? m.replace(QUERY_AND_PARAMS, '').replace(PG_KEY_DETAIL, '').replace(EMAIL, '[email]').trim().slice(0, 200) : '')

/**
 * What may go into the logs about an error: its name, the message with email addresses replaced by [email] and cut to
 * 200 characters, and the Postgres error code if there is one. Never the raw error: a failed Drizzle query carries the
 * statement with its parameters (names, emails), so everything from "Failed query" / "params:" on is dropped (the cause's
 * message, which is Postgres' own, stands in when nothing is left) and so is the `Key (col)=(value)` detail.
 */
export function describeError(e: unknown): string {
  const err = (e ?? {}) as { name?: unknown; message?: unknown; code?: unknown; cause?: { code?: unknown; message?: unknown } }
  const name = typeof err.name === 'string' ? err.name : typeof e
  const message = clean(err.message) || clean(err.cause?.message)
  const code = [err.code, err.cause?.code].find((c) => typeof c === 'string' && /^[0-9A-Z]{5}$/.test(c))
  return `${name}: ${message}${code ? ` (postgres ${code})` : ''}`
}
