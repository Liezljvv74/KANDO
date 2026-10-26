import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { pool } from '@kando/db'

let sessionId = 'none'
vi.mock('../lib/auth/server', () => ({
  getAuth: () => ({
    getSession: async () => ({ data: { user: { id: sessionId } } }),
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
