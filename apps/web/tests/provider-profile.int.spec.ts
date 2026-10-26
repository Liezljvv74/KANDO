import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { pool } from '@kando/db'
import { MyProfileSchema } from '@kando/contract'
import { call, cleanupUsers, profile } from './helpers'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const { GET, PUT } = await import('../app/app-api/v1/provider-profile/route')

beforeAll(async () => {
  await pool.query(
    `INSERT INTO postcodes (country, code, place, state, location) VALUES
     ('DE', '10115', 'Berlin', 'Berlin', ST_SetSRID(ST_MakePoint(13.3, 52.5), 4326)) ON CONFLICT DO NOTHING`,
  )
})
afterAll(cleanupUsers)

it('GET is null when there is no profile', async () => {
  const res = await call(GET, 'pp1')
  expect(res.status).toBe(200)
  expect(await res.json()).toBeNull()
})

it('PUT creates (201) and a later PUT edits (200); responses fit the contract', async () => {
  await call(GET, 'pp2') // first contact
  await pool.query("UPDATE users SET name = 'Anna-Lena von der Heide' WHERE id = 'pp2'")
  const created = await call(PUT, 'pp2', 'PUT', profile)
  expect(created.status).toBe(201)
  const body = MyProfileSchema.parse(await created.json())
  expect(body).toMatchObject({ displayName: 'Babysitting am Abend', status: 'draft', publicName: 'Anna-Lena H.', suspended: false })
  const edited = await call(PUT, 'pp2', 'PUT', { bio: 'Hallo', skills: ['Kochen'] })
  expect(edited.status).toBe(200)
  expect(MyProfileSchema.parse(await edited.json())).toMatchObject({ id: body.id, bio: 'Hallo', skills: ['Kochen'], displayName: 'Babysitting am Abend' })
  expect(MyProfileSchema.parse(await (await call(GET, 'pp2')).json()).bio).toBe('Hallo')
  const loc = await pool.query("SELECT location IS NOT NULL AS has FROM providers WHERE owner_id = 'pp2'")
  expect(loc.rows[0].has).toBe(true)
})

it('an unknown postcode is 400 and changes nothing', async () => {
  const res = await call(PUT, 'pp2', 'PUT', { basePostcode: '00000' })
  expect(res.status).toBe(400)
  expect(await res.json()).toEqual({ error: 'Unknown postcode' })
  expect(MyProfileSchema.parse(await (await call(GET, 'pp2')).json()).basePostcode).toBe('10115')
})

it('first save needs displayName and providerType; a business needs a business name', async () => {
  let res = await call(PUT, 'pp3', 'PUT', { bio: 'x' })
  expect(res.status).toBe(400)
  expect(await res.json()).toEqual({ error: 'Invalid fields', fields: ['displayName', 'providerType'] })
  res = await call(PUT, 'pp3', 'PUT', { displayName: 'Nord', providerType: 'business' })
  expect(res.status).toBe(400)
  expect(await res.json()).toEqual({ error: 'Invalid fields', fields: ['businessName'] })
  expect((await call(PUT, 'pp3', 'PUT', { displayName: 'Nord', providerType: 'business', businessName: 'Nord GmbH' })).status).toBe(201)
})

it('status, slug and suspended in the body are ignored', async () => {
  await call(PUT, 'pp2', 'PUT', { status: 'published', slug: 'mine', suspended: false })
  const row = (await pool.query("SELECT status, slug FROM providers WHERE owner_id = 'pp2'")).rows[0]
  expect(row).toEqual({ status: 'draft', slug: null })
})

it("one user's profile is not visible to another", async () => {
  expect(await (await call(GET, 'pp4')).json()).toBeNull()
})

it('an invalid body is 400 with the contract error', async () => {
  const res = await call(PUT, 'pp2', 'PUT', { serviceRadiusKm: 500 })
  expect(res.status).toBe(400)
  expect((await res.json()).error).toBe('Invalid input')
})
