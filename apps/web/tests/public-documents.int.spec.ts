import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { asUser, pool } from '@kando/db'
import { sql } from 'drizzle-orm'
import { ProviderDetailSchema } from '@kando/contract'
import { cleanupUsers, EMAIL, seedBase, seedProvider } from './helpers'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const route = await import('../app/app-api/v1/providers/[slug]/route')

let categoryId: string
const ids: Record<string, string> = {}
const doc = (uid: string, requirement: string, status: string, reviewedAt: string | null = '2026-01-01T10:00:00Z') =>
  pool.query(
    "INSERT INTO documents (owner_id, requirement, key, status, note, reviewed_at) VALUES ($1, $2, $3, $4, 'secret note', $5)",
    [uid, requirement, `documents/${uid}/${requirement}-${Math.random()}.pdf`, status, status === 'pending' ? null : reviewedAt],
  )
beforeAll(async () => {
  ;({ categoryId } = await seedBase())
  for (const u of ['pd-a', 'pd-b', 'pd-none', 'pd-susp', 'pd-draft']) {
    ids[u] = await seedProvider(u, { name: u, categoryId, suspended: u === 'pd-susp', status: u === 'pd-draft' ? 'draft' : 'published' })
  }
  // Inserted out of order on purpose: the answer follows DOCUMENT_TYPES.
  await doc('pd-a', 'liability-insurance', 'approved')
  await doc('pd-a', 'id-document', 'approved')
  await doc('pd-a', 'permit', 'pending')
  await doc('pd-a', 'police-certificate', 'rejected')
  await doc('pd-a', 'craft-qualification', 'approved', '2026-01-01T10:00:00Z') // approved, then rejected later
  await doc('pd-a', 'craft-qualification', 'rejected', '2026-02-01T10:00:00Z')
  await doc('pd-a', 'hygiene-certificate', 'rejected', '2026-01-01T10:00:00Z') // rejected, then approved later
  await doc('pd-a', 'hygiene-certificate', 'approved', '2026-02-01T10:00:00Z')
  await doc('pd-a', 'first-aid-certificate', 'approved')
  await doc('pd-a', 'first-aid-certificate', 'pending') // a new pending check does not remove the approval
  await doc('pd-b', 'trade-registration', 'approved')
  for (const u of ['pd-susp', 'pd-draft']) await doc(u, 'id-document', 'approved')
})
afterAll(cleanupUsers)

const get = (slug: string, uid?: string) =>
  route.GET(
    new Request(`http://localhost/app-api/v1/providers/${slug}`, uid ? { headers: { cookie: `uid=${uid}:${EMAIL(uid)}` } } : undefined),
    { params: Promise.resolve({ slug }) },
  )
const checked = async (slug: string, uid?: string) => ProviderDetailSchema.parse(await (await get(slug, uid)).json()).checkedDocuments

it('approved documents show, in DOCUMENT_TYPES order; pending and rejected ones do not; the latest review decides', async () => {
  expect(await checked('pd-a-slug')).toEqual(['id-document', 'liability-insurance', 'hygiene-certificate', 'first-aid-certificate'])
})

it("another provider's documents never leak; no documents means an empty list", async () => {
  expect(await checked('pd-b-slug')).toEqual(['trade-registration'])
  expect(await checked('pd-none-slug')).toEqual([])
})

it('anonymous, the owner and another user get the same list', async () => {
  const anon = await checked('pd-a-slug')
  expect(await checked('pd-a-slug', 'pd-a')).toEqual(anon)
  expect(await checked('pd-a-slug', 'pd-b')).toEqual(anon)
})

it('the response carries type keys only: no file keys, notes, dates or ids of documents', async () => {
  const text = JSON.stringify(await (await get('pd-a-slug')).json())
  expect(text).not.toMatch(/documents\/|secret note|reviewed|2026-0|"note"|"key"/)
  expect(text).toContain('"checkedDocuments":["id-document","liability-insurance","hygiene-certificate","first-aid-certificate"]')
})

it('a suspended or unpublished provider still has no profile', async () => {
  expect((await get('pd-susp-slug')).status).toBe(404)
  expect((await get('pd-draft-slug')).status).toBe(404)
})

it('an older cached response without the field still parses (empty list)', () => {
  const { checkedDocuments: _, ...old } = ProviderDetailSchema.parse({
    slug: 's', publicName: 'n', photoUrl: null, place: null, categories: [], services: [], references: [], photos: [], isNew: true, translatable: false,
  })
  expect(ProviderDetailSchema.parse(old).checkedDocuments).toEqual([])
  expect(ProviderDetailSchema.parse(old).providerId).toBeUndefined() // an older response without the provider id parses too
})

it('RLS: app_user cannot read the documents table; the function returns type keys only, and nothing for a hidden provider', async () => {
  expect((await asUser(null, (tx) => tx.execute(sql`SELECT * FROM documents`))).rows).toEqual([])
  expect((await asUser('pd-b', (tx) => tx.execute(sql`SELECT * FROM documents WHERE owner_id = 'pd-a'`))).rows).toEqual([])
  const fn = async (u: string | null, p: string) =>
    (await asUser(u, (tx) => tx.execute<{ d: string[] }>(sql`SELECT public_checked_documents(${p}::uuid) AS d`))).rows[0]!.d
  expect(await fn(null, ids['pd-a']!)).toEqual(['first-aid-certificate', 'hygiene-certificate', 'id-document', 'liability-insurance'])
  for (const u of ['pd-susp', 'pd-draft']) expect(await fn(u, ids[u]!), u).toEqual([]) // not even for the owner
})
