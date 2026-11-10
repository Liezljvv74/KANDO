import { expect, it } from 'vitest'

import { cosine, embedTexts, EMBEDDING_MODEL, MIN_SCORE } from './search'
import { helpTopics } from './topics'

// SLOW suite: calls the real embedding model (a few cents at most). Skipped unless OPENROUTER_API_KEY is set AND RUN_AI_SLOW=1.
// It is the guard behind MIN_SCORE: related wording must reach it, nonsense and off-topic text must stay clearly below it.
// Re-run it (and re-measure) whenever EMBEDDING_MODEL or the Help texts change: RUN_AI_SLOW=1 pnpm --filter @kando/domain exec vitest run help-search.real
const run = !!process.env.OPENROUTER_API_KEY && process.env.RUN_AI_SLOW === '1'
const MARGIN_ABOVE = 0.02
const MARGIN_BELOW = 0.05

type Lang = 'de' | 'en'
// Related wording with (almost) no shared word: the top topic by meaning must be one of `any`.
const RELATED: [string, Lang, string[]][] = [
  ['when do I get my money back', 'en', ['money-strip', 'finishing-a-job', 'paying']],
  ['Wann bekomme ich mein Geld zurück', 'de', ['money-strip', 'finishing-a-job', 'paying']],
  ['was passiert wenn ich absage', 'de', ['cancelling']],
  ['how do I cancel a booking', 'en', ['cancelling']],
  ['the provider did not show up', 'en', ['no-show']],
  ['Handwerker ist nicht erschienen', 'de', ['no-show']],
  ['how do I delete my account', 'en', ['delete-your-account']],
  ['Konto löschen', 'de', ['delete-your-account']],
  ['who checks the providers', 'en', ['checked-and-verified', 'finding-providers']],
  ['wie werden Anbieter geprüft', 'de', ['checked-and-verified', 'finding-providers']],
]
const NOTHING: [string, Lang][] = [
  ['asdfgh', 'en'], ['xyzzy qwerty', 'de'], ['pizza recipe', 'en'], ['Pizza Rezept', 'de'], ['weather tomorrow', 'en'], ['Wetter morgen', 'de'],
  ['bitcoin price', 'en'], ['how tall is mount everest', 'en'], ['Fußball Ergebnisse', 'de'],
]

it.skipIf(!run)(`related wording is found and nonsense is not (model ${EMBEDDING_MODEL})`, async () => {
  const topics = helpTopics().filter((t) => t.approved)
  const queries = [...RELATED.map((r) => [r[0], r[1]] as [string, Lang]), ...NOTHING]
  const out = await embedTexts([...topics.flatMap((t) => [`${t.titleDe}\n${t.bodyDe}`, `${t.titleEn}\n${t.bodyEn}`]), ...queries.map((q) => q[0])])
  const docs = out.slice(0, topics.length * 2)
  const best = queries.map(([q, lang], i) => {
    const scores = topics.map((t, j) => ({ slug: t.slug, score: cosine(out[topics.length * 2 + i]!, docs[2 * j + (lang === 'en' ? 1 : 0)]!) })).sort((a, b) => b.score - a.score)
    return { q, lang, ...scores[0]! }
  })
  console.log(`MIN_SCORE ${MIN_SCORE}\nlang | query | best topic | score\n${best.map((b) => `${b.lang} | ${b.q} | ${b.slug} | ${b.score.toFixed(3)}`).join('\n')}`)
  RELATED.forEach(([q, , any], i) => {
    expect(any, `"${q}" -> ${best[i]!.slug}`).toContain(best[i]!.slug)
    expect(best[i]!.score, `"${q}" is too close to MIN_SCORE`).toBeGreaterThanOrEqual(MIN_SCORE + MARGIN_ABOVE)
  })
  best.slice(RELATED.length).forEach((b) => expect(b.score, `"${b.q}" (best: ${b.slug}) is too close to MIN_SCORE`).toBeLessThanOrEqual(MIN_SCORE - MARGIN_BELOW))
}, 60_000)
