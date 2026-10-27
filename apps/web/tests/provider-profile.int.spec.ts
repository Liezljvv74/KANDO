import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { asUser, pool } from '@kando/db'
import { setStorageForTests, updateMe } from '@kando/domain'
import { MeSchema, type MePatch, MyProfileSchema } from '@kando/contract'
import { call, cleanupUsers, EMAIL, givePhoto, memoryStorage, profile, seedBase } from './helpers'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const { GET, PUT, POST } = await import('../app/app-api/v1/provider-profile/route')
const publishRoute = await import('../app/app-api/v1/provider-profile/publish/route')
const servicesRoute = await import('../app/app-api/v1/services/route')
const serviceRoute = await import('../app/app-api/v1/services/[id]/route')
const searchRoute = await import('../app/app-api/v1/providers/route')
const sitemap = await import('../app/(site)/providers-sitemap.xml/route')
const me = await import('../app/app-api/v1/me/route')

beforeAll(async () => {
  setStorageForTests(memoryStorage())
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
  await pool.query("UPDATE users SET first_name = 'Anna-Lena', last_name = 'von der Heide' WHERE id = 'pp2'")
  const created = await call(PUT, 'pp2', 'PUT', profile)
  expect(created.status).toBe(201)
  const body = MyProfileSchema.parse(await created.json())
  expect(body).toMatchObject({ status: 'draft', publicName: 'Anna-Lena H.', suspendedUntil: null })
  const edited = await call(PUT, 'pp2', 'PUT', { bio: 'Hallo', skills: ['Kochen'] })
  expect(edited.status).toBe(200)
  expect(MyProfileSchema.parse(await edited.json())).toMatchObject({ id: body.id, bio: 'Hallo', skills: ['Kochen'] })
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

it('a partial first save never fails on business rules', async () => {
  expect((await call(PUT, 'pp3', 'PUT', { bio: 'x' })).status).toBe(201)
  expect((await call(PUT, 'pp3', 'PUT', { providerType: 'business' })).status).toBe(200)
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

it('an unconfirmed email gets 403 EMAIL_NOT_VERIFIED from PUT provider-profile and GET /me, and no users row', async () => {
  // fakeSession: the cookie "verified=0" makes the session unconfirmed.
  const unverified = (method: string, body?: unknown) =>
    new Request('http://localhost/app-api/v1/x', {
      method,
      headers: { cookie: `uid=pp-unv:${EMAIL('pp-unv')}; verified=0`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const ctx = { params: Promise.resolve({}) }
  for (const res of [await PUT(unverified('PUT', profile), ctx), await me.GET(unverified('GET'), ctx)]) {
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'EMAIL_NOT_VERIFIED' })
  }
  expect((await pool.query("SELECT 1 FROM users WHERE id = 'pp-unv'")).rows).toHaveLength(0)
  // a confirmed session still passes
  expect((await call(me.GET, 'pp-ver')).status).toBe(200)
  expect((await call(PUT, 'pp-ver', 'PUT', profile)).status).toBe(201)
})

it('PATCH /me checks its body with the contract: 400 Invalid input names the field; a valid patch saves', async () => {
  for (const [body, field] of [[{ firstName: 'x'.repeat(61) }, 'firstName'], [{ lastName: '   ' }, 'lastName'], [{ language: 'fr' }, 'language']] as const) {
    const res = await call(me.PATCH, 'pp-me', 'PATCH', body)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('Invalid input')
    expect(json.issues[0].path).toEqual([field])
  }
  const ok = await call(me.PATCH, 'pp-me', 'PATCH', { firstName: '  Anna ', lastName: 'Schmidt', language: 'en' })
  expect(ok.status).toBe(200)
  expect(MeSchema.parse(await ok.json())).toMatchObject({ id: 'pp-me', firstName: 'Anna', lastName: 'Schmidt', language: 'en', address: null, notifications: [] })
})

it('updateMe stores country DE when the address carries none (the HTTP contract always sends one)', async () => {
  await call(me.GET, 'pp-dflt')
  const patch = { address: { street: 'Weg 2', postcode: '10115', city: 'Berlin' } } as unknown as MePatch
  expect((await asUser('pp-dflt', (tx) => updateMe(tx, 'pp-dflt', patch))).address?.country).toBe('DE')
})

it('PATCH /me stores names and a private address (country stored as sent); GET /me returns them; null clears the address', async () => {
  const set = await call(me.PATCH, 'pp-addr', 'PATCH', { firstName: 'Anna', lastName: 'Schmidt', address: { street: 'Hauptstr. 1', postcode: '10115', city: 'Berlin', country: 'DE' } })
  expect(set.status).toBe(200)
  const got = MeSchema.parse(await (await call(me.GET, 'pp-addr')).json())
  expect(got).toMatchObject({ firstName: 'Anna', lastName: 'Schmidt', address: { street: 'Hauptstr. 1', postcode: '10115', city: 'Berlin', country: 'DE' }, photoUrl: null })
  const cleared = await call(me.PATCH, 'pp-addr', 'PATCH', { address: null })
  expect(MeSchema.parse(await cleared.json()).address).toBeNull()
  const row = (await pool.query("SELECT address_street, address_postcode, address_city, address_country FROM users WHERE id = 'pp-addr'")).rows[0]
  expect(row).toEqual({ address_street: null, address_postcode: null, address_city: null, address_country: null })
})

const missingOf = async (res: Response) => MyProfileSchema.parse(await res.json()).missing
const ALL = ['photo', 'service', 'providerType', 'skills', 'experience', 'postcode', 'radius']

it('POST creates a draft with the postcode prefilled; again returns the same id; GET /me is fine', async () => {
  await call(me.GET, 'dr1')
  await pool.query("UPDATE users SET address_postcode = '10115', address_street = 's', address_city = 'c' WHERE id = 'dr1'")
  const a = await call(POST, 'dr1', 'POST')
  expect(a.status).toBe(200)
  const draft = MyProfileSchema.parse(await a.json())
  expect(draft).toMatchObject({ status: 'draft', providerType: null, basePostcode: '10115', serviceRadiusKm: 25 })
  expect(draft.missing).toEqual(['photo', 'service', 'providerType', 'skills', 'experience'])
  expect(MyProfileSchema.parse(await (await call(POST, 'dr1', 'POST')).json()).id).toBe(draft.id)
  const m = await (await call(me.GET, 'dr1')).json()
  expect(m.isProvider).toBe(true)
})

it('missing: the empty draft lists the person-independent items, business adds two, saves shrink it, PUT carries it', async () => {
  await call(me.GET, 'dr2')
  const empty = await missingOf(await call(POST, 'dr2', 'POST'))
  expect(empty).toEqual(['photo', 'service', 'providerType', 'skills', 'experience', 'postcode'])
  const biz = await missingOf(await call(PUT, 'dr2', 'PUT', { providerType: 'business' }))
  expect(biz).toEqual(['photo', 'service', 'businessName', 'impressum', 'skills', 'experience', 'postcode'])
  const next = await missingOf(await call(PUT, 'dr2', 'PUT', { businessName: 'Nord', basePostcode: '10115', skills: ['a'] }))
  expect(next).toEqual(['photo', 'service', 'impressum', 'experience'])
  expect(ALL).toContain('radius')
})

it('publish of an incomplete draft is 409 with the list; complete publishes with public name Lena F.', async () => {
  const { categoryId } = await seedBase()
  await pool.query("INSERT INTO category_texts (category_id, lang, name) VALUES ($1, 'de', 'Gartenarbeit'), ($1, 'en', 'Gardening') ON CONFLICT DO NOTHING", [categoryId])
  await call(me.GET, 'dr3')
  await pool.query("UPDATE users SET first_name = 'Lena', last_name = 'Fischer' WHERE id = 'dr3'")
  await call(POST, 'dr3', 'POST')
  const refused = await call(publishRoute.POST, 'dr3', 'POST')
  expect(refused.status).toBe(409)
  expect(await refused.json()).toEqual({ error: 'Profile incomplete', missing: ['photo', 'service', 'providerType', 'skills', 'experience', 'postcode'] })

  // a service with a category alone: title = category name in the user's language, no price type, not offerable
  const created = await call(servicesRoute.POST, 'dr3', 'POST', { categoryId, currency: 'EUR' })
  expect(created.status).toBe(201)
  expect(await created.json()).toMatchObject({ title: 'Gartenarbeit', priceType: null, price: null })
  const sid = (await pool.query("SELECT id FROM services WHERE provider_id = (SELECT id FROM providers WHERE owner_id = 'dr3')")).rows[0].id
  expect((await pool.query("SELECT count(*)::int AS n FROM offerable_service_ids((SELECT id FROM providers WHERE owner_id = 'dr3'))")).rows[0].n).toBe(0)
  expect(await missingOf(await call(PUT, 'dr3', 'PUT', {}))).toContain('service')
  await pool.query("UPDATE users SET language = 'en' WHERE id = 'dr3'")
  const en = await call(servicesRoute.POST, 'dr3', 'POST', { categoryId, title: '  ', currency: 'EUR' })
  expect((await en.json()).title).toBe('Gardening')
  const blank = await call(serviceRoute.PATCH, 'dr3', 'PATCH', { title: '' }, { id: sid })
  expect((await blank.json()).title).toBe('Gardening')
  await call(serviceRoute.PATCH, 'dr3', 'PATCH', { priceType: 'on-request', currency: 'EUR' }, { id: sid })
  expect(await missingOf(await call(PUT, 'dr3', 'PUT', {}))).not.toContain('service')

  await givePhoto('dr3')
  await call(PUT, 'dr3', 'PUT', { providerType: 'individual', skills: ['a'], experience: '5 Jahre', basePostcode: '10115' })
  const ok = await call(publishRoute.POST, 'dr3', 'POST')
  expect(ok.status).toBe(200)
  expect(MyProfileSchema.parse(await ok.json())).toMatchObject({ status: 'published', publicName: 'Lena F.', missing: [] })
})

it('a draft with every nullable field null is invisible in search and the sitemap', async () => {
  await call(me.GET, 'dr4')
  const id = MyProfileSchema.parse(await (await call(POST, 'dr4', 'POST')).json()).id
  const res = await searchRoute.GET(new Request('http://localhost/app-api/v1/providers?postcode=10115'), { params: Promise.resolve({}) })
  expect(res.status).toBe(200)
  expect(JSON.stringify(await res.json())).not.toContain(id)
  expect(await (await sitemap.GET()).text()).not.toContain(id)
  expect((await pool.query('SELECT 1 FROM providers WHERE id = $1 AND status = $2 AND slug IS NULL', [id, 'draft'])).rows).toHaveLength(1)
})

it('a draft created during a suspension cannot be published', async () => {
  await call(POST, 'dr5', 'POST')
  await pool.query("UPDATE providers SET suspended_until = now() + interval '1 day' WHERE owner_id = 'dr5'")
  const res = await call(publishRoute.POST, 'dr5', 'POST')
  expect(res.status).toBe(409)
})
