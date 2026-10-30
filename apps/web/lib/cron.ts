import { timingSafeEqual } from 'node:crypto'

/** The one CRON_SECRET check of the cron routes (Vercel sends `Authorization: Bearer <secret>`). No secret configured: nobody gets in. */
export function cronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  const given = Buffer.from(request.headers.get('authorization') ?? '')
  const expected = Buffer.from(`Bearer ${secret}`)
  return !!secret && given.length === expected.length && timingSafeEqual(given, expected)
}
