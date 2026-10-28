const EMAIL = /[^\s@<>()"',;:]+@[^\s@<>()"',;]+\.[^\s@<>()"',;]+/g

/**
 * What may go into the logs about an error: its name, the message with email addresses replaced by [email] and cut to
 * 200 characters, and the Postgres error code if there is one. Never the raw error: a failed Drizzle query carries the
 * statement with its parameters (names, emails).
 */
export function describeError(e: unknown): string {
  const err = (e ?? {}) as { name?: unknown; message?: unknown; code?: unknown; cause?: { code?: unknown } }
  const name = typeof err.name === 'string' ? err.name : typeof e
  const message = typeof err.message === 'string' ? err.message.replace(EMAIL, '[email]').slice(0, 200) : ''
  const code = [err.code, err.cause?.code].find((c) => typeof c === 'string' && /^[0-9A-Z]{5}$/.test(c))
  return `${name}: ${message}${code ? ` (postgres ${code})` : ''}`
}
