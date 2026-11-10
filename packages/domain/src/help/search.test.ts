import { afterEach, expect, it, vi } from 'vitest'

import { cosine, embedTexts, EmbeddingUnavailable, mergeHits, MAX_RESULTS, MIN_SCORE, type Candidate } from './search'

const topic = (slug: string, sort = 1) => ({ slug, sort, group: 'your-data' as const, title: slug, body: `body ${slug}` })
const cand = (slug: string, rank: number, vector: number[] | null, sort = 1): Candidate => ({ topic: topic(slug, sort), rank, vector })
const slugs = (r: { slug: string }[]) => r.map((t) => t.slug)

afterEach(() => vi.unstubAllGlobals())

it('cosine: 1 for the same direction, 0 for orthogonal, 0 for different lengths or zero vectors', () => {
  expect(cosine([1, 2], [2, 4])).toBeCloseTo(1)
  expect(cosine([1, 0], [0, 1])).toBe(0)
  expect(cosine([1, 0], [1])).toBe(0)
  expect(cosine([0, 0], [1, 1])).toBe(0)
})

it('merge: a keyword hit stays without a vector; a meaning hit needs MIN_SCORE; the rest is left out', () => {
  const q = [1, 0]
  const near = [1, 0] // 1.0
  const far = [0, 1] // 0
  const result = mergeHits([cand('keyword', 0.2, null), cand('meaning', 0, near), cand('nothing', 0, far)], q)
  expect(slugs(result)).toEqual(['keyword', 'meaning'])
})

it('merge: the threshold is inclusive and uses MIN_SCORE by default', () => {
  const at = [MIN_SCORE, Math.sqrt(1 - MIN_SCORE ** 2)] // cosine with [1, 0] is MIN_SCORE
  expect(slugs(mergeHits([cand('at', 0, at)], [1, 0], MIN_SCORE))).toEqual(['at'])
  expect(slugs(mergeHits([cand('below', 0, [MIN_SCORE - 0.01, Math.sqrt(1 - (MIN_SCORE - 0.01) ** 2)])], [1, 0]))).toEqual([])
})

it('merge: keyword hits first (best rank first), then by similarity; ties by sort order', () => {
  const q = [1, 0]
  const v = (c: number) => [c, Math.sqrt(1 - c * c)]
  const result = mergeHits(
    [cand('m-low', 0, v(0.5), 1), cand('k-low', 0.1, v(0.1), 2), cand('m-high', 0, v(0.9), 3), cand('k-high', 0.5, null, 4), cand('k-low2', 0.1, v(0.8), 5)],
    q,
  )
  expect(slugs(result)).toEqual(['k-high', 'k-low2', 'k-low', 'm-high', 'm-low'])
})

it(`merge: at most ${MAX_RESULTS} results`, () => {
  const many = Array.from({ length: 10 }, (_, i) => cand(`t${i}`, 0.1 + i / 100, null, i))
  expect(mergeHits(many, null)).toHaveLength(MAX_RESULTS)
  expect(slugs(mergeHits(many, null))[0]).toBe('t9')
})

it('merge: without a query vector or stored vectors only keyword hits are returned', () => {
  const list = [cand('k', 0.3, [1, 0]), cand('m', 0, [1, 0])]
  expect(slugs(mergeHits(list, null))).toEqual(['k'])
  expect(slugs(mergeHits([cand('k', 0.3, null), cand('m', 0, null)], [1, 0]))).toEqual(['k'])
})

it('embedTexts: needs a key, orders the answer by index and sends the privacy settings', async () => {
  vi.stubEnv('OPENROUTER_API_KEY', '')
  await expect(embedTexts(['a'])).rejects.toBeInstanceOf(EmbeddingUnavailable)
  vi.stubEnv('OPENROUTER_API_KEY', 'test-key-not-real')
  const fetchMock = vi.fn(async () => Response.json({ data: [{ index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }] }))
  vi.stubGlobal('fetch', fetchMock)
  expect(await embedTexts(['a', 'b'])).toEqual([[1, 0], [0, 1]])
  const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body)
  expect(body.provider).toEqual({ data_collection: 'deny', zdr: true, allow_fallbacks: false })
  expect(body.input).toEqual(['a', 'b'])
  vi.unstubAllEnvs()
})

it('embedTexts: an error status, a wrong count or a network error is EmbeddingUnavailable', async () => {
  vi.stubEnv('OPENROUTER_API_KEY', 'test-key-not-real')
  vi.stubGlobal('fetch', async () => new Response('no', { status: 500 }))
  await expect(embedTexts(['a'])).rejects.toBeInstanceOf(EmbeddingUnavailable)
  vi.stubGlobal('fetch', async () => Response.json({ data: [] }))
  await expect(embedTexts(['a'])).rejects.toBeInstanceOf(EmbeddingUnavailable)
  vi.stubGlobal('fetch', async () => {
    throw new Error('offline')
  })
  await expect(embedTexts(['a'])).rejects.toBeInstanceOf(EmbeddingUnavailable)
  vi.unstubAllEnvs()
})
