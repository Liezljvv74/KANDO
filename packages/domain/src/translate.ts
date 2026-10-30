import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { detect } from 'tinyld'
import type { ProviderDetail, TranslatableTexts } from '@kando/contract'
import type { Exec } from './providers/eligibility'
import type { Lang } from '@kando/i18n'
import type { SessionUser } from './users'

export type { TranslatableTexts }

// OpenRouter slug of the current fast Claude model (Haiku tier), checked 2026-10-26 in https://openrouter.ai/api/v1/models
// (the list also holds anthropic/claude-haiku-4.5, the older one). Override with TRANSLATE_MODEL.
export const DEFAULT_TRANSLATE_MODEL = 'anthropic/claude-haiku-5.5'

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'
export const TRANSLATE_LIMIT_PER_HOUR = 30
/** Calls allowed across all callers together per 24 hours (caps the OpenRouter bill however many addresses an abuser has); env TRANSLATE_GLOBAL_LIMIT_PER_DAY overrides it. */
export const TRANSLATE_GLOBAL_LIMIT_PER_DAY = 2000
/** Default time to wait for the model, in ms; env TRANSLATE_TIMEOUT_MS overrides it. */
export const TRANSLATE_TIMEOUT_MS = 12_000

const LANGUAGE_NAME: Record<Lang, string> = { de: 'German', en: 'English' }

const SYSTEM_PROMPT = (lang: Lang) =>
  `You translate texts from a service marketplace profile page into ${LANGUAGE_NAME[lang]}. You get a JSON object whose values are texts.
- Translate each value into the target language.
- Keep line breaks, list markers and paragraph order.
- Do not add, drop or summarise content.
- Leave person and business names, brand names, prices, numbers, URLs and emails unchanged.
- If a value is already in the target language, return it unchanged.
- Answer with a JSON object with exactly the same keys.`

/** The translation could not be made: no key, rate limit, timeout, provider error or unusable answer. */
export class TranslationUnavailable extends Error {}

export const textsOf = (p: ProviderDetail): TranslatableTexts => ({
  bio: p.bio ?? null,
  strengths: p.strengths ?? null,
  experience: p.experience ?? null,
  skills: p.skills ?? [],
  services: p.services.map((s) => ({ id: s.id, title: s.title, description: s.description })),
  references: p.references.map((r) => ({ id: r.id, description: r.description })),
})

// Stable ids: bio, strengths, experience, skill:0, service:<id>:title, service:<id>:description, reference:<id>
function flatten(t: TranslatableTexts): Record<string, string> {
  const all: Record<string, string | null> = { bio: t.bio, strengths: t.strengths, experience: t.experience }
  t.skills.forEach((s, i) => (all[`skill:${i}`] = s))
  for (const s of t.services) {
    all[`service:${s.id}:title`] = s.title
    all[`service:${s.id}:description`] = s.description
  }
  for (const r of t.references) all[`reference:${r.id}`] = r.description
  return Object.fromEntries(Object.entries(all).filter((e): e is [string, string] => !!e[1]?.trim()))
}

function rebuild(t: TranslatableTexts, f: Record<string, string>): TranslatableTexts {
  return {
    bio: t.bio && (f.bio ?? t.bio),
    strengths: t.strengths && (f.strengths ?? t.strengths),
    experience: t.experience && (f.experience ?? t.experience),
    skills: t.skills.map((s, i) => f[`skill:${i}`] ?? s),
    services: t.services.map((s) => ({
      ...s,
      title: f[`service:${s.id}:title`] ?? s.title,
      description: s.description && (f[`service:${s.id}:description`] ?? s.description),
    })),
    references: t.references.map((r) => ({ ...r, description: f[`reference:${r.id}`] ?? r.description })),
  }
}

// tinyld misdetects short words with confidence ("Umzug" -> ber), so one text only counts when it is long enough.
const LONG_TEXT = 80

/** Decides for the button and for the model call: detect once on the whole page, plus any single long text in another language. */
export function needsTranslation(texts: TranslatableTexts, lang: Lang): boolean {
  const all = Object.values(flatten(texts))
  const joined = all.join('\n')
  const page = detect(joined)
  if (page ? page !== lang : joined.length >= 20) return true
  return all.some((text) => text.length >= LONG_TEXT && detect(text) !== lang)
}

const MIN_SECRET = 16
let warned = false
/** Fail closed: without a real secret the public ip: hashes would be plain sha256(ip), reversible over the IPv4 space. */
function requireSecret(): string {
  const secret = process.env.NEON_AUTH_COOKIE_SECRET
  if (secret && secret.length >= MIN_SECRET) return secret
  if (!warned) {
    warned = true
    console.error('[translate] NEON_AUTH_COOKIE_SECRET is missing or shorter than 16 characters: translation is unavailable')
  }
  throw new TranslationUnavailable('No usable secret configured')
}

/**
 * Callers are counted per user id; anonymous ones as a salted hash of the address Vercel itself sets (x-vercel-forwarded-for,
 * else x-real-ip), never the raw address. x-forwarded-for is not used: a caller can put anything at its start.
 */
export function clientKeyOf(user: Pick<SessionUser, 'id'> | null, headers: Pick<Headers, 'get'>): string {
  if (user) return `user:${user.id}`
  const ip = (headers.get('x-vercel-forwarded-for') || headers.get('x-real-ip'))?.split(',')[0]?.trim() || 'unknown'
  const hash = createHash('sha256').update(`${requireSecret()}${ip}`).digest('hex')
  return `ip:${hash.slice(0, 32)}`
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

/**
 * Translates the texts into `lang`: from the store, else one model call for whatever is missing. Throws TranslationUnavailable.
 * `storedOnly` never calls the model (a plain page view must not cost money): anything missing throws TranslationUnavailable.
 * Reads work on any `exec`; the counter, the model call and the stored answers need the owner connection (`db`, never a request transaction).
 */
export async function translateTexts(exec: Exec, texts: TranslatableTexts, lang: Lang, clientKey: string, storedOnly = false): Promise<TranslatableTexts> {
  if (!needsTranslation(texts, lang)) return texts
  requireSecret() // before any count, insert or model call
  const flat = flatten(texts)
  const keys = Object.fromEntries(Object.keys(flat).map((id) => [id, sha256(flat[id]!)]))
  const result: Record<string, string> = {}

  const hashes = [...new Set(Object.values(keys))]
  if (hashes.length) {
    const { rows } = await exec.execute<{ key: string; text: string }>(
      sql`SELECT key, text FROM translations WHERE lang = ${lang} AND key IN (${sql.join(hashes.map((h) => sql`${h}`), sql`, `)})`,
    )
    const stored = new Map(rows.map((r) => [r.key, r.text]))
    for (const id of Object.keys(flat)) {
      const hit = stored.get(keys[id]!)
      if (hit !== undefined) result[id] = hit
      else if (flat[id]!.length >= LONG_TEXT && detect(flat[id]!) === lang) result[id] = flat[id]!
    }
  }

  const missing = Object.keys(flat).filter((id) => !(id in result))
  if (missing.length) {
    if (storedOnly) throw new TranslationUnavailable('Not translated yet')
    const answer = await askModel(exec, Object.fromEntries(missing.map((id) => [id, flat[id]!])), lang, clientKey)
    for (const id of missing) {
      result[id] = answer[id]!
      await exec.execute(sql`INSERT INTO translations (key, lang, text) VALUES (${keys[id]}, ${lang}, ${answer[id]}) ON CONFLICT (key, lang) DO NOTHING`)
    }
  }
  return rebuild(texts, result)
}

async function askModel(exec: Exec, sent: Record<string, string>, lang: Lang, clientKey: string): Promise<Record<string, string>> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) throw new TranslationUnavailable('No translation key configured')

  const limit = Number(process.env.TRANSLATE_LIMIT_PER_HOUR) || TRANSLATE_LIMIT_PER_HOUR
  await exec.execute(sql`DELETE FROM translation_requests WHERE created_at < now() - interval '24 hours'`)
  const { rows } = await exec.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM translation_requests WHERE client_key = ${clientKey} AND created_at > now() - interval '1 hour'`,
  )
  if (rows[0]!.n >= limit) throw new TranslationUnavailable('Rate limit reached')
  const globalLimit = Number(process.env.TRANSLATE_GLOBAL_LIMIT_PER_DAY) || TRANSLATE_GLOBAL_LIMIT_PER_DAY
  const day = await exec.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM translation_requests WHERE created_at > now() - interval '24 hours'`)
  if (day.rows[0]!.n >= globalLimit) throw new TranslationUnavailable('Global rate limit reached')
  await exec.execute(sql`INSERT INTO translation_requests (client_key) VALUES (${clientKey})`)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Number(process.env.TRANSLATE_TIMEOUT_MS) || TRANSLATE_TIMEOUT_MS)
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.TRANSLATE_MODEL || DEFAULT_TRANSLATE_MODEL,
        temperature: 0,
        max_tokens: Math.min(4000, Math.max(256, Math.ceil((JSON.stringify(sent).length / 3) * 2))),
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT(lang) },
          { role: 'user', content: JSON.stringify(sent) },
        ],
      }),
      signal: controller.signal,
    })
    if (!res.ok) throw new TranslationUnavailable(`Translation service answered ${res.status}`)
    const content = ((await res.json()) as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content as string
    const answer = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))
    if (!Object.keys(sent).every((id) => typeof answer?.[id] === 'string' && answer[id].trim())) throw new Error('incomplete')
    return answer
  } catch (e) {
    throw e instanceof TranslationUnavailable ? e : new TranslationUnavailable('Translation failed')
  } finally {
    clearTimeout(timer)
  }
}
