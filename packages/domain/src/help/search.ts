import { sql } from 'drizzle-orm'
import { HelpTopicSchema, type HelpTopic } from '@kando/contract'
import { isLang } from '@kando/i18n'

import type { Exec } from '../providers/eligibility'

/**
 * The one embedding model (OpenRouter /embeddings): multilingual, answers with `zdr` (no storage) on this account, 1536 numbers per text,
 * 0.02 US dollar per million tokens. Changing this constant makes the seed rebuild every stored vector.
 */
export const EMBEDDING_MODEL = 'openai/text-embedding-3-small'
const ENDPOINT = 'https://openrouter.ai/api/v1/embeddings'
const TIMEOUT_MS = 8_000

/**
 * A topic is found by meaning when its cosine similarity to the search text is at least this. Chosen from the measured scores of the
 * fixture list in help-search.real.spec.ts (see the report of PR 7b); re-measure with `RUN_AI_SLOW=1` when the model or the texts change.
 */
export const MIN_SCORE = 0.37
export const MAX_RESULTS = 6
export const MIN_QUERY_CHARS = 2
export const MAX_QUERY_CHARS = 100
/** Searches allowed per hour: signed out per IP address (salted hash), signed in per account. */
export const HELP_SEARCH_LIMITS = { signedOut: 20, signedIn: 60 }
/** Searches across everybody per 24 hours; above it only the keyword part runs (no embedding call). Env HELP_SEARCH_GLOBAL_LIMIT_PER_DAY overrides it. */
export const HELP_SEARCH_GLOBAL_LIMIT_PER_DAY = 3000

export type Embedder = (texts: string[]) => Promise<number[][]>
export class EmbeddingUnavailable extends Error {}
export class HelpSearchLimited extends Error {}

/** Embeds the texts, in order, with OpenRouter. Server side only; no tools, no storage at the provider. Throws EmbeddingUnavailable (no key, error, timeout, bad answer). */
export const embedTexts: Embedder = async (texts) => {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) throw new EmbeddingUnavailable('No embedding key configured')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts, provider: { data_collection: 'deny', zdr: true, allow_fallbacks: false } }),
      signal: controller.signal,
    })
    if (!res.ok) throw new EmbeddingUnavailable(`Embedding service answered ${res.status}`)
    const data = ((await res.json()) as { data?: { index: number; embedding: number[] }[] }).data
    const out = data && [...data].sort((a, b) => a.index - b.index).map((d) => d.embedding)
    if (!out || out.length !== texts.length || !out.every((v) => Array.isArray(v) && v.length > 0 && v.every(Number.isFinite))) throw new EmbeddingUnavailable('Unusable embedding answer')
    return out
  } catch (e) {
    throw e instanceof EmbeddingUnavailable ? e : new EmbeddingUnavailable('Embedding call failed')
  } finally {
    clearTimeout(timer)
  }
}

/** The real embedder when a key is set, else null (keyword search only). */
export const defaultEmbedder = (): Embedder | null => (process.env.OPENROUTER_API_KEY ? embedTexts : null)

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    na += a[i]! ** 2
    nb += b[i]! ** 2
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

export type Candidate = { topic: HelpTopic; rank: number; vector: number[] | null }

/**
 * Keyword hits (rank above 0) first, best rank first; then the topics whose similarity reaches `minScore`, best first. A keyword hit
 * with a vector is ordered by rank, then similarity. No query vector (no key, call failed) or no stored vector: keyword only.
 */
export function mergeHits(candidates: Candidate[], queryVector: number[] | null, minScore = MIN_SCORE, limit = MAX_RESULTS): HelpTopic[] {
  const scored = candidates.map((c) => ({ ...c, sim: queryVector && c.vector ? cosine(queryVector, c.vector) : null }))
  return scored
    .filter((c) => c.rank > 0 || (c.sim !== null && c.sim >= minScore))
    .sort((a, b) => Number(b.rank > 0) - Number(a.rank > 0) || b.rank - a.rank || (b.sim ?? -1) - (a.sim ?? -1) || a.topic.sort - b.topic.sort)
    .slice(0, limit)
    .map((c) => c.topic)
}

/** Every approved topic in `lang` with its keyword rank for `q` (0 = no hit) and stored vector. Full-text search in the language's configuration plus the search text inside the title (compound words, prefixes). */
export async function candidatesFor(exec: Exec, q: string, lang: string): Promise<Candidate[]> {
  if (!isLang(lang)) throw new Error(`unknown language ${lang}`)
  const en = lang === 'en'
  const cfg = en ? sql`'english'` : sql`'german'`
  const title = en ? sql`title_en` : sql`title_de`
  const body = en ? sql`body_en` : sql`body_de`
  // Vectors made by another model are not comparable with a query embedded now: treated as missing until the seed rebuilt them.
  const embedding = sql`CASE WHEN embedding_model = ${EMBEDDING_MODEL} THEN ${en ? sql`embedding_en` : sql`embedding_de`} END`
  const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`
  const { rows } = await exec.execute<Record<string, unknown>>(sql`
    SELECT slug, sort, "group", ${title} AS title, ${body} AS body, ${embedding} AS embedding,
      CASE WHEN to_tsvector(${cfg}, ${title} || ' ' || ${body}) @@ websearch_to_tsquery(${cfg}, ${q})
        THEN ts_rank(to_tsvector(${cfg}, ${title} || ' ' || ${body}), websearch_to_tsquery(${cfg}, ${q})) ELSE 0 END
      + CASE WHEN ${title} ILIKE ${like} ESCAPE '\\' THEN 0.1 ELSE 0 END AS rank
    FROM help_topics WHERE approved ORDER BY sort, slug`)
  return rows.map((r) => ({
    topic: HelpTopicSchema.parse({ slug: r.slug, sort: r.sort, group: r.group, title: r.title, body: r.body }),
    rank: Number(r.rank),
    vector: Array.isArray(r.embedding) ? (r.embedding as number[]) : null,
  }))
}

/**
 * Searches the approved Help topics (title and body of the language asked for): keyword and meaning together, at most 6, never an
 * unapproved one. The text is never stored or logged. Counts the search per `clientKey` (rows of `translation_requests`, prefixed
 * `help-search:`, deleted after 24 hours): over the hourly limit throws HelpSearchLimited; when only the daily global budget is used up
 * (or the embedding call fails) the keyword part still answers. Needs the owner connection (`db`, never a request transaction).
 */
export async function searchHelp(exec: Exec, input: { q: string; lang: string; clientKey: string; signedIn: boolean; embed?: Embedder | null }): Promise<HelpTopic[]> {
  const q = input.q.trim().replace(/\s+/g, ' ')
  const key = `help-search:${input.clientKey}`
  await exec.execute(sql`DELETE FROM translation_requests WHERE created_at < now() - interval '24 hours'`)
  const inserted = await exec.execute<{ id: string }>(sql`INSERT INTO translation_requests (client_key) VALUES (${key}) RETURNING id`)
  const { rows } = await exec.execute<{ h: number; d: number }>(sql`
    SELECT count(*) FILTER (WHERE client_key = ${key} AND created_at > now() - interval '1 hour')::int AS h, count(*)::int AS d
    FROM translation_requests WHERE client_key LIKE 'help-search:%' AND created_at > now() - interval '24 hours'`)
  if (rows[0]!.h > (input.signedIn ? HELP_SEARCH_LIMITS.signedIn : HELP_SEARCH_LIMITS.signedOut)) {
    await exec.execute(sql`DELETE FROM translation_requests WHERE id = ${inserted.rows[0]!.id}`)
    throw new HelpSearchLimited('Rate limit reached')
  }
  const embedBudget = rows[0]!.d <= (Number(process.env.HELP_SEARCH_GLOBAL_LIMIT_PER_DAY) || HELP_SEARCH_GLOBAL_LIMIT_PER_DAY)

  const candidates = await candidatesFor(exec, q, input.lang)
  let queryVector: number[] | null = null
  const embed = input.embed === undefined ? defaultEmbedder() : input.embed
  if (embed && embedBudget && candidates.some((c) => c.vector)) {
    try {
      queryVector = (await embed([q]))[0] ?? null
    } catch {
      console.error('[help-search] embedding unavailable: keyword results only')
    }
  }
  return mergeHits(candidates, queryVector)
}
