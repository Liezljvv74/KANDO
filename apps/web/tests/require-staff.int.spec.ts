import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { pool } from '@kando/db'

let sessionId = 'none'
let authStatus = 200
vi.mock('../lib/auth/server', () => ({
  getAuth: () => ({
    getSession: async () => (authStatus === 200 ? { data: { user: { id: sessionId } }, error: null } : { data: null, error: { status: authStatus } }),
  }),
}))

const { requireStaff } = await import('../lib/require-staff')

beforeAll(async () => {
  await pool.query(`INSERT INTO users (id, email, staff_role, suspended_until) VALUES
    ('s-admin', 's-admin@test.skilled.invalid', 'admin', null),
    ('s-susp', 's-susp@test.skilled.invalid', 'admin', now() + interval '1 day'),
    ('s-past', 's-past@test.skilled.invalid', 'reviewer', now() - interval '1 day')`)
})
afterAll(async () => {
  await pool.query("DELETE FROM users WHERE email LIKE 's-%@test.skilled.invalid'")
})

const status = async (id: string, role: 'admin' | 'reviewer' | 'any') => {
  sessionId = id
  try {
    await requireStaff(role)
    return 200
  } catch (e) {
    return (e as Response).status
  }
}

it('an active admin passes', async () => expect(await status('s-admin', 'admin')).toBe(200))
it('a suspended admin gets 403', async () => expect(await status('s-susp', 'any')).toBe(403))
it('an expired suspension no longer blocks', async () => expect(await status('s-past', 'reviewer')).toBe(200))
it('a busy login server is 503 AUTH_BUSY, not a sign-out; a real 401 stays 401', async () => {
  authStatus = 429
  const busy = await requireStaff('any').catch((e: Response) => e)
  expect((busy as Response).status).toBe(503)
  expect(await (busy as Response).json()).toEqual({ error: 'AUTH_BUSY' })
  authStatus = 401
  expect(await status('s-admin', 'any')).toBe(401)
  authStatus = 200
})
