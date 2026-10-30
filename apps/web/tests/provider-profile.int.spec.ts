import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { pool } from '@kando/db'
import { setStorageForTests } from '@kando/domain/src/testing'
import { MeSchema, MyProfileSchema } from '@kando/contract'
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
      headers: { origin: 'http://localhost', cookie: `uid=pp-unv:${EMAIL('pp-unv')}; verified=0`, 'content-type': 'application/json' },
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

it('an address with only a postcode is stored and returned; a street without a postcode is refused; null clears it', async () => {
  const patch = (address: unknown) => call(me.PATCH, 'pp-addr', 'PATCH', { address })
  expect((await patch({ postcode: '10115', country: 'DE' })).status).toBe(200)
  expect(MeSchema.parse(await (await call(me.GET, 'pp-addr')).json()).address).toEqual({ street: null, postcode: '10115', city: null, country: 'DE' })
  expect((await patch({ street: 'Weg 1', postcode: '10115', city: ' ', country: 'DE' })).status).toBe(200)
  expect(MeSchema.parse(await (await call(me.GET, 'pp-addr')).json()).address).toEqual({ street: 'Weg 1', postcode: '10115', city: null, country: 'DE' })
  expect((await patch({ street: 'Weg 1', country: 'DE' })).status).toBe(400)
  expect((await patch({ postcode: 'abc', country: 'DE' })).status).toBe(400)
  expect((await patch({ postcode: '99999', country: 'DE' })).status).toBe(200) // well-formed but not in the table: accepted
  expect((await patch({ postcode: '10115', country: 'DE' })).status).toBe(200) // keys absent after a full address clear street and city
  expect(MeSchema.parse(await (await call(me.GET, 'pp-addr')).json()).address).toEqual({ street: null, postcode: '10115', city: null, country: 'DE' })
  expect((await patch(null)).status).toBe(200)
  expect(MeSchema.parse(await (await call(me.GET, 'pp-addr')).json()).address).toBeNull()
  expect((await pool.query("SELECT address_street, address_postcode, address_city, address_country FROM users WHERE id = 'pp-addr'")).rows[0]).toEqual({ address_street: null, address_postcode: null, address_city: null, address_country: null })
})

it('a user without an address still gets a draft (the provider row default country applies)', async () => {
  await call(me.GET, 'pp-noaddr')
  const res = await call(POST, 'pp-noaddr', 'POST')
  expect(MyProfileSchema.parse(await res.json())).toMatchObject({ status: 'draft', basePostcode: null })
  expect((await pool.query("SELECT country FROM providers WHERE owner_id = 'pp-noaddr'")).rows[0].country).toBe('DE')
})

const missingOf = async (res: Response) => MyProfileSchema.parse(await res.json()).missing

it('POST creates a draft with the postcode prefilled; again returns the same id; GET /me is fine', async () => {
  await call(me.GET, 'dr1')
  await pool.query("UPDATE users SET address_postcode = '10115', address_street = 's', address_city = 'c', address_country = 'DE' WHERE id = 'dr1'")
  const a = await call(POST, 'dr1', 'POST')
  expect(a.status).toBe(200)
  const draft = MyProfileSchema.parse(await a.json())
  expect(draft).toMatchObject({ status: 'draft', providerType: null, basePostcode: '10115', serviceRadiusKm: 25 })
  expect(draft.missing).toEqual(['name', 'service', 'providerType', 'strengths', 'skills'])
  expect(MyProfileSchema.parse(await (await call(POST, 'dr1', 'POST')).json()).id).toBe(draft.id)
  const m = await (await call(me.GET, 'dr1')).json()
  expect(m.isProvider).toBe(true)
})

it('missing: the empty draft lists the person-independent items, business adds two, saves shrink it, PUT carries it', async () => {
  await call(me.GET, 'dr2')
  const empty = await missingOf(await call(POST, 'dr2', 'POST'))
  expect(empty).toEqual(['name', 'service', 'providerType', 'strengths', 'skills', 'postcode'])
  const biz = await missingOf(await call(PUT, 'dr2', 'PUT', { providerType: 'business' }))
  expect(biz).toEqual(['name', 'service', 'businessName', 'impressum', 'strengths', 'skills', 'postcode'])
  const next = await missingOf(await call(PUT, 'dr2', 'PUT', { businessName: 'Nord', basePostcode: '10115', skills: ['a'] }))
  expect(next).toEqual(['name', 'service', 'impressum', 'strengths'])
})

it('publish of an incomplete draft is 409 with the list; complete publishes with public name Lena F.', async () => {
  const { categoryId } = await seedBase()
  await pool.query("INSERT INTO category_texts (category_id, lang, name) VALUES ($1, 'de', 'Gartenarbeit'), ($1, 'en', 'Gardening') ON CONFLICT DO NOTHING", [categoryId])
  await call(me.GET, 'dr3')
  await pool.query("UPDATE users SET first_name = 'Lena', last_name = 'Fischer' WHERE id = 'dr3'")
  await call(POST, 'dr3', 'POST')
  const refused = await call(publishRoute.POST, 'dr3', 'POST')
  expect(refused.status).toBe(409)
  expect(await refused.json()).toEqual({ error: 'Profile incomplete', missing: ['service', 'providerType', 'strengths', 'skills', 'postcode'] })

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
  await call(PUT, 'dr3', 'PUT', { providerType: 'individual', strengths: 'Ruhig', skills: ['a'], basePostcode: '10115' })
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

it('the draft prefills the postcode only when it is a known one', async () => {
  await call(me.GET, 'dr6')
  await pool.query("UPDATE users SET address_postcode = '00000', address_country = 'DE' WHERE id = 'dr6'")
  const bad = MyProfileSchema.parse(await (await call(POST, 'dr6', 'POST')).json())
  expect(bad.basePostcode).toBeNull()
  expect(bad.missing).toContain('postcode')
  await call(me.GET, 'dr7')
  await pool.query("UPDATE users SET address_postcode = '10115', address_country = 'DE' WHERE id = 'dr7'")
  const good = MyProfileSchema.parse(await (await call(POST, 'dr7', 'POST')).json())
  expect(good.basePostcode).toBe('10115')
  expect(good.missing).not.toContain('postcode')
})

it('a live profile cannot be emptied by a save: 409 with the missing list, nothing changed', async () => {
  const { categoryId } = await seedBase()
  await call(me.GET, 'lv1')
  await pool.query("UPDATE users SET first_name = 'Lena', last_name = 'Fischer' WHERE id = 'lv1'")
  await call(PUT, 'lv1', 'PUT', profile)
  await call(servicesRoute.POST, 'lv1', 'POST', { categoryId, priceType: 'on-request', currency: 'EUR' })
  await givePhoto('lv1')
  expect((await call(publishRoute.POST, 'lv1', 'POST')).status).toBe(200)
  const before = (await pool.query("SELECT type, skills, strengths, base_postcode FROM providers WHERE owner_id = 'lv1'")).rows[0]
  for (const [body, missing] of [
    [{ skills: [] }, 'skills'],
    [{ strengths: null }, 'strengths'],
    [{ basePostcode: null }, 'postcode'],
    [{ providerType: 'business' }, 'businessName'],
  ] as const) {
    const res = await call(PUT, 'lv1', 'PUT', body)
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toBe('Profile incomplete')
    expect(json.missing).toContain(missing)
  }
  expect((await pool.query("SELECT type, skills, strengths, base_postcode FROM providers WHERE owner_id = 'lv1'")).rows[0]).toEqual(before)
  expect((await call(PUT, 'lv1', 'PUT', { bio: 'ok' })).status).toBe(200) // a harmless edit still saves
})

it('a live profile cannot delete its last complete service: 409, nothing deleted; another service makes it fine', async () => {
  const { categoryId } = await seedBase()
  await call(me.GET, 'lv2')
  await pool.query("UPDATE users SET first_name = 'Lena', last_name = 'Fischer' WHERE id = 'lv2'")
  await call(PUT, 'lv2', 'PUT', profile)
  const first = await (await call(servicesRoute.POST, 'lv2', 'POST', { categoryId, priceType: 'on-request', currency: 'EUR' })).json()
  await givePhoto('lv2')
  expect((await call(publishRoute.POST, 'lv2', 'POST')).status).toBe(200)
  const drop = (id: string) => call(serviceRoute.DELETE, 'lv2', 'DELETE', undefined, { id })
  const refused = await drop(first.id)
  expect(refused.status).toBe(409)
  expect(await refused.json()).toEqual({ error: 'Profile incomplete', missing: ['service'] })
  expect((await pool.query("SELECT count(*)::int AS n FROM services WHERE id = $1", [first.id])).rows[0].n).toBe(1)
  const second = await (await call(servicesRoute.POST, 'lv2', 'POST', { categoryId, priceType: 'on-request', currency: 'EUR' })).json()
  expect((await drop(first.id)).status).toBe(204)
  expect((await drop(second.id)).status).toBe(409)
})

it('deleting a service is not blocked by an unrelated missing item, only by "service" newly missing', async () => {
  const { categoryId } = await seedBase()
  await call(me.GET, 'lv3')
  await pool.query("UPDATE users SET first_name = 'Lena', last_name = 'Fischer' WHERE id = 'lv3'")
  await call(PUT, 'lv3', 'PUT', profile)
  const first = await (await call(servicesRoute.POST, 'lv3', 'POST', { categoryId, priceType: 'on-request', currency: 'EUR' })).json()
  const second = await (await call(servicesRoute.POST, 'lv3', 'POST', { categoryId, priceType: 'on-request', currency: 'EUR' })).json()
  await givePhoto('lv3')
  expect((await call(publishRoute.POST, 'lv3', 'POST')).status).toBe(200)
  await pool.query("UPDATE providers SET skills = '{}' WHERE owner_id = 'lv3'") // already incomplete for another reason
  const drop = (id: string) => call(serviceRoute.DELETE, 'lv3', 'DELETE', undefined, { id })
  expect((await drop(first.id)).status).toBe(204)
  const refused = await drop(second.id)
  expect(refused.status).toBe(409) // the last service: "service" is newly missing
  expect((await refused.json()).missing).toContain('service')
})

it('a provider whose names are missing cannot publish: missing lists name', async () => {
  const { categoryId } = await seedBase()
  await call(me.GET, 'nm1')
  await call(PUT, 'nm1', 'PUT', profile)
  await call(servicesRoute.POST, 'nm1', 'POST', { categoryId, priceType: 'on-request', currency: 'EUR' })
  await givePhoto('nm1')
  const res = await call(publishRoute.POST, 'nm1', 'POST')
  expect(res.status).toBe(409)
  expect((await res.json()).missing).toEqual(['name'])
})

it("the draft's postcode lookup uses the owner's stored country", async () => {
  await pool.query("INSERT INTO countries (code, name_de, name_en, postcode_pattern, currency) VALUES ('ZZ', 'Testland', 'Testland', '^[0-9]{4}$', 'EUR') ON CONFLICT DO NOTHING")
  await pool.query("INSERT INTO postcodes (country, code, place, state, location) VALUES ('ZZ', '2000', 'Testburg', 'Test', ST_SetSRID(ST_MakePoint(28.0, -26.2), 4326)) ON CONFLICT DO NOTHING")
  try {
    await call(me.GET, 'pp-zz')
    await pool.query("UPDATE users SET address_street = 'Main 1', address_postcode = '2000', address_city = 'Testburg', address_country = 'ZZ' WHERE id = 'pp-zz'")
    const draft = MyProfileSchema.parse(await (await call(POST, 'pp-zz', 'POST')).json())
    expect(draft.basePostcode).toBe('2000')
    expect((await pool.query("SELECT country FROM providers WHERE owner_id = 'pp-zz'")).rows[0].country).toBe('ZZ')
  } finally {
    await pool.query("DELETE FROM providers WHERE owner_id = 'pp-zz'")
    await pool.query("DELETE FROM postcodes WHERE country = 'ZZ'")
    await pool.query("DELETE FROM countries WHERE code = 'ZZ'")
  }
})
