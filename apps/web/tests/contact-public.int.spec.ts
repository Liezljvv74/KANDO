import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { pool } from '@kando/db'
import { call, cleanupUsers, profile, relaxLimits, seedBase } from './helpers'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const profileRoute = await import('../app/app-api/v1/provider-profile/route')
const servicesRoute = await import('../app/app-api/v1/services/route')
const referencesRoute = await import('../app/app-api/v1/references/route')
const me = await import('../app/app-api/v1/me/route')

const PHONE = 'Call me on 0176 12345678'
const attempts = async (uid: string) => (await pool.query('SELECT count(*)::int n FROM contact_attempts WHERE user_id = $1', [uid])).rows[0].n
const refused = async (res: Response) => {
  expect(res.status).toBe(422)
  expect(await res.json()).toMatchObject({ error: 'CONTACT_DETAILS' })
}
let categoryId: string

beforeAll(async () => {
  await cleanupUsers()
  categoryId = (await seedBase()).categoryId
  await pool.query(`INSERT INTO postcodes (country, code, place, state, location) VALUES ('DE', '10115', 'Berlin', 'Berlin', ST_SetSRID(ST_MakePoint(13.3, 52.5), 4326)) ON CONFLICT DO NOTHING`)
})
afterAll(cleanupUsers)

it('a phone number in the bio, a service description, a reference and a last name is 422 CONTACT_DETAILS and nothing is saved', async () => {
  const u = 'cp1'
  await relaxLimits(u)
  expect((await call(profileRoute.PUT, u, 'PUT', profile)).status).toBe(201)
  await refused(await call(profileRoute.PUT, u, 'PUT', { bio: PHONE }))
  await refused(await call(servicesRoute.POST, u, 'POST', { categoryId, title: 'Mowing', description: PHONE }))
  await refused(await call(referencesRoute.POST, u, 'POST', { clientName: 'Meier', description: PHONE }))
  await refused(await call(me.PATCH, u, 'PATCH', { lastName: '0176 12345678' }))
  expect((await pool.query('SELECT bio FROM providers WHERE owner_id = $1', [u])).rows[0].bio).toBeNull()
  expect((await pool.query('SELECT count(*)::int n FROM services WHERE provider_id IN (SELECT id FROM providers WHERE owner_id = $1)', [u])).rows[0].n).toBe(0)
  expect((await pool.query('SELECT count(*)::int n FROM provider_references WHERE provider_id IN (SELECT id FROM providers WHERE owner_id = $1)', [u])).rows[0].n).toBe(0)
  expect((await pool.query('SELECT last_name FROM users WHERE id = $1', [u])).rows[0].last_name).not.toBe('0176 12345678')
})

it('an email in the business name and a link in a skill are refused', async () => {
  const u = 'cp2'
  await relaxLimits(u)
  await refused(await call(profileRoute.PUT, u, 'PUT', { ...profile, businessName: 'Write to anna@example.com' }))
  await refused(await call(profileRoute.PUT, u, 'PUT', { ...profile, skills: ['Gartenarbeit', 'www.example.com'] }))
})

it('an impressum with a phone number and an email is saved', async () => {
  const u = 'cp3'
  await relaxLimits(u)
  const res = await call(profileRoute.PUT, u, 'PUT', { ...profile, impressum: 'Anna, Tel 0176 12345678, anna@example.com', taxNumber: '12/345/67890' })
  expect(res.status).toBe(201)
})

it('a save that does not send the bio passes although the stored bio holds a phone number', async () => {
  const u = 'cp4'
  await relaxLimits(u)
  await call(profileRoute.PUT, u, 'PUT', profile)
  await pool.query('UPDATE providers SET bio = $2 WHERE owner_id = $1', [u, PHONE])
  expect((await call(profileRoute.PUT, u, 'PUT', { strengths: 'Fleißig' })).status).toBe(200)
})

it('one refused save records one attempt', async () => {
  const u = 'cp5'
  await relaxLimits(u)
  await call(profileRoute.PUT, u, 'PUT', profile)
  await refused(await call(profileRoute.PUT, u, 'PUT', { bio: PHONE, strengths: 'mail me anna@example.com', experience: 'or www.example.com' }))
  expect(await attempts(u)).toBe(1)
})
