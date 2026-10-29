import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const cron = await import('../app/api/cron/bookings/route')
const get = (auth?: string) => cron.GET(new Request('http://localhost/api/cron/bookings', { headers: auth ? { authorization: auth } : {} }))

beforeEach(() => vi.stubEnv('CRON_SECRET', 's3cret'))
afterEach(() => vi.unstubAllEnvs())

it('401 without the bearer token, with a wrong one, and when CRON_SECRET is unset', async () => {
  expect((await get()).status).toBe(401)
  expect((await get('Bearer wrong')).status).toBe(401)
  vi.stubEnv('CRON_SECRET', '')
  expect((await get('Bearer ')).status).toBe(401)
  expect((await get('Bearer undefined')).status).toBe(401)
})

it('200 with the report for the right token', async () => {
  const res = await get('Bearer s3cret')
  expect(res.status).toBe(200)
  expect(Object.keys(await res.json()).sort()).toEqual(['ignoredNotices', 'proposalsLapsed', 'quotesExpired', 'remindersSent', 'requestsExpired', 'unpaidExpired'])
})
