import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { pool } from '@kando/db'
import { MyProfileSchema } from '@kando/contract'
import { publicNameFor, slugify } from '@kando/domain'
import { call, givePhoto, cleanupUsers, EMAIL, profile, seedBase } from './helpers'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const profileRoute = await import('../app/app-api/v1/provider-profile/route')
const publish = await import('../app/app-api/v1/provider-profile/publish/route')
const services = await import('../app/app-api/v1/services/route')

let categoryId: string
beforeAll(async () => {
  ;({ categoryId } = await seedBase())
})
afterAll(cleanupUsers)

it('publicNameFor: business name, else first name and surname initial', () => {
  const ind = { providerType: 'individual' as const, businessName: null }
  expect(publicNameFor(ind, 'Liezl Fourie')).toBe('Liezl F.')
  expect(publicNameFor(ind, 'Anna-Lena von der Heide')).toBe('Anna-Lena H.')
  expect(publicNameFor(ind, 'Cher')).toBe('Cher')
  expect(publicNameFor(ind, '  Jörg   Müller  ')).toBe('Jörg M.')
  expect(publicNameFor({ providerType: 'business', businessName: ' Müller Elektro GmbH ' }, 'Jörg Müller')).toBe('Müller Elektro GmbH')
  expect(publicNameFor({ providerType: 'business', businessName: '  ' }, 'Jörg Müller')).toBe('Jörg M.')
})

it('slugify transliterates umlauts and strips the rest', () => {
  expect(slugify('Müller Bäckerei & Söhne ß')).toBe('mueller-baeckerei-soehne-ss')
  expect(slugify('  !!! ')).toBe('profile')
  expect(slugify('x'.repeat(100))).toHaveLength(60)
})

const setup = async (uid: string, businessName: string) => {
  await call(profileRoute.GET, uid)
  const p = { displayName: 'Schreinerei', providerType: 'business', businessName, impressum: 'Impressum', basePostcode: '10115' }
  expect((await call(profileRoute.PUT, uid, 'PUT', p)).status).toBe(201)
  await givePhoto(uid)
  await call(services.POST, uid, 'POST', { categoryId, title: 'S', priceType: 'on-request', price: null, currency: 'EUR' })
  return (await call(publish.POST, uid, 'POST')).status
}
const slugOf = async (uid: string) => (await pool.query('SELECT slug FROM providers WHERE owner_id = $1', [uid])).rows[0].slug

it('public name and slug are unique and stable', async () => {
  expect(await setup('pn1', 'Tischlerei Nord')).toBe(200)
  expect(await setup('pn2', 'Tischlerei Nord')).toBe(200)
  expect(await slugOf('pn1')).toBe('tischlerei-nord')
  expect(await slugOf('pn2')).toBe('tischlerei-nord-2')
  const renamed = await call(profileRoute.PUT, 'pn1', 'PUT', { businessName: 'Tischlerei Nord GmbH' })
  expect(MyProfileSchema.parse(await renamed.json()).publicName).toBe('Tischlerei Nord GmbH')
  expect((await call(publish.POST, 'pn1', 'POST')).status).toBe(200) // republish
  expect(await slugOf('pn1')).toBe('tischlerei-nord')
})

it('an individual without an account name gets a slug from the display name, never "profile"', async () => {
  await call(profileRoute.GET, 'pn3')
  await pool.query("UPDATE users SET name = '' WHERE id = 'pn3'")
  expect((await call(profileRoute.PUT, 'pn3', 'PUT', profile)).status).toBe(201)
  await givePhoto('pn3')
  await call(services.POST, 'pn3', 'POST', { categoryId, title: 'S', priceType: 'on-request', price: null, currency: 'EUR' })
  expect((await call(publish.POST, 'pn3', 'POST')).status).toBe(200)
  expect(await slugOf('pn3')).toBe('babysitting-am-abend')
})

it('first contact copies the account name from the session; a later contact does not overwrite it', async () => {
  const as = (name: string) =>
    new Request('http://localhost/app-api/v1/x', {
      method: 'PUT',
      headers: { cookie: `uid=pn4:${EMAIL('pn4')}; name=${encodeURIComponent(name)}`, 'content-type': 'application/json' },
      body: JSON.stringify(profile),
    })
  const created = await profileRoute.PUT(as('Anna Schmidt'), { params: Promise.resolve({}) })
  expect(MyProfileSchema.parse(await created.json()).publicName).toBe('Anna S.')
  await profileRoute.PUT(as('Someone Else'), { params: Promise.resolve({}) })
  expect((await pool.query("SELECT name FROM users WHERE id = 'pn4'")).rows[0].name).toBe('Anna Schmidt')
})
