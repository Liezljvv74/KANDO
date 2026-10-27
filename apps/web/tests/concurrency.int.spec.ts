import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { cleanupUsers, seedBase, seedProvider } from './helpers'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const list = await import('../app/app-api/v1/providers/route')
const page = await import('../app/app-api/v1/providers/[slug]/route')

beforeAll(async () => {
  const { categoryId } = await seedBase()
  await seedProvider('cc-1', { name: 'Concurrent', categoryId })
})
afterAll(cleanupUsers)

// Each request holds a pooled connection for its transaction: nothing inside may wait for a second one (pool max 10).
it('12 concurrent searches and 12 concurrent public pages all complete', async () => {
  const searches = Array.from({ length: 12 }, () =>
    list.GET(new Request('http://localhost/app-api/v1/providers?postcode=10115'), { params: Promise.resolve({}) }),
  )
  const pages = Array.from({ length: 12 }, () =>
    page.GET(new Request('http://localhost/app-api/v1/providers/cc-1-slug'), { params: Promise.resolve({ slug: 'cc-1-slug' }) }),
  )
  const res = await Promise.all([...searches, ...pages])
  expect(res.map((r) => r.status)).toEqual(Array(24).fill(200))
}, 15_000)
