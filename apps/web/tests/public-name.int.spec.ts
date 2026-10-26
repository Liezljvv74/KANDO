import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { pool } from '@kando/db'
import { MyProfileSchema } from '@kando/contract'
import { publicNameFor, slugify } from '@kando/domain'
import { call, cleanupUsers, seedBase } from './helpers'

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
  await pool.query('UPDATE providers SET photo_id = gen_random_uuid() WHERE owner_id = $1', [uid])
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
