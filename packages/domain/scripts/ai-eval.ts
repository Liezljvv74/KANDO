// Evaluation of candidate models for the AI document check (MVP plan step 2.6): `pnpm ai:eval`.
// Draws about twenty MADE-UP documents locally, asks every model in AI_EVAL_MODELS about each one through the same client the app
// uses, and writes Reports/ai-document-check-evaluation-<date>.md. It calls the network and costs money (about 20 calls per model),
// so it needs OPENROUTER_API_KEY and AI_EVAL_MODELS; without them it only explains and exits. `--fixtures-only <dir>` writes the
// documents as files (no key, no network) so they can be looked at.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openRouterChecker } from '../src/ai/openrouter'
import { minConfidence, TYPE_NAME, wouldAutoApprove } from '../src/ai/rules'
import { fixtures } from './ai-eval-fixtures'

const REPORTS = join(import.meta.dirname, '..', '..', '..', 'Reports')

const args = process.argv.slice(2)
const folder = args[0] === '--fixtures-only' ? args[1] : undefined
if (args[0] === '--fixtures-only') {
  if (!folder) {
    console.log('Usage: pnpm ai:eval --fixtures-only <folder>')
    process.exit(0)
  }
  mkdirSync(folder, { recursive: true })
  for (const f of fixtures()) {
    const { bytes, mime } = await f.render()
    writeFileSync(join(folder, `${f.id}.${mime === 'application/pdf' ? 'pdf' : 'png'}`), bytes)
  }
  console.log(`Wrote ${fixtures().length} made-up documents to ${folder}`)
  process.exit(0)
}

const apiKey = process.env.OPENROUTER_API_KEY
const models = (process.env.AI_EVAL_MODELS ?? '').split(',').map((m) => m.trim()).filter(Boolean)
if (!apiKey || !models.length) {
  console.log(
    [
      'The evaluation did not run, and nothing was sent anywhere.',
      !apiKey ? '- OPENROUTER_API_KEY is not set (put it in the root .env file; it stays on this machine).' : '',
      !models.length ? '- AI_EVAL_MODELS is empty: set it to a comma separated list of OpenRouter model ids, for example AI_EVAL_MODELS=vendor/model-a,vendor/model-b' : '',
      'Then run `pnpm ai:eval` again. It makes about 20 paid calls per model on made-up documents. Use `pnpm ai:eval --fixtures-only <folder>` to look at the documents without a key.',
    ]
      .filter(Boolean)
      .join('\n'),
  )
  process.exit(0)
}

const today = new Date().toISOString().slice(0, 10)
const set = fixtures()
const min = minConfidence()
console.log(`Evaluating ${models.length} model(s) on ${set.length} made-up documents. Documents are sent to OpenRouter with no-training and zero-retention routing; every one is fictional.`)

type Row = { id: string; expected: 'ok' | 'problem'; approved: boolean | null; verdict: string; confidence: number | null; ms: number; costUsd: number | null; error: string | null }
const results = new Map<string, Row[]>()
for (const model of models) {
  const checker = openRouterChecker({ apiKey, model, provider: process.env.AI_DOCUMENT_PROVIDER?.trim() || undefined })
  const rows: Row[] = []
  for (const f of set) {
    const { bytes, mime } = await f.render()
    const started = Date.now()
    try {
      const out = await checker.check({ bytes, mime, documentType: TYPE_NAME[f.type] ?? f.type, names: f.names, today })
      rows.push({ id: f.id, expected: f.expected, approved: wouldAutoApprove(out.result, min), verdict: out.result.verdict, confidence: out.result.confidence, ms: Date.now() - started, costUsd: out.costUsd, error: null })
    } catch (e) {
      rows.push({ id: f.id, expected: f.expected, approved: null, verdict: '-', confidence: null, ms: Date.now() - started, costUsd: null, error: e instanceof Error ? e.message : 'error' })
    }
    process.stdout.write('.')
  }
  process.stdout.write(`  ${model}\n`)
  results.set(model, rows)
}

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)} %` : 'n/a')
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const p95 = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil(xs.length * 0.95) - 1)]! : null)

let table = '| Model | Accuracy | False approvals | False rejections | Errors | Cost per document (USD) | Latency avg / p95 (s) |\n|---|---|---|---|---|---|---|\n'
for (const [model, rows] of results) {
  const bads = rows.filter((r) => r.expected === 'problem')
  const goods = rows.filter((r) => r.expected === 'ok')
  // An error means "a person decides": right for a problem document, a false rejection for a good one.
  const falseApprovals = bads.filter((r) => r.approved === true).length
  const falseRejections = goods.filter((r) => r.approved !== true).length
  const correct = rows.length - falseApprovals - falseRejections
  const costs = rows.map((r) => r.costUsd).filter((c): c is number => c !== null)
  const ms = rows.filter((r) => !r.error).map((r) => r.ms)
  table += `| ${model} | ${pct(correct, rows.length)} (${correct}/${rows.length}) | ${falseApprovals} of ${bads.length} | ${falseRejections} of ${goods.length} | ${rows.filter((r) => r.error).length} | ${avg(costs)?.toFixed(5) ?? 'not reported'} | ${avg(ms) === null ? 'n/a' : `${(avg(ms)! / 1000).toFixed(1)} / ${(p95(ms)! / 1000).toFixed(1)}`} |\n`
}

let detail = `| Document | Expected | ${[...results.keys()].join(' | ')} |\n|---|---|${[...results.keys()].map(() => '---|').join('')}\n`
for (const f of set) {
  const cells = [...results.values()].map((rows) => {
    const r = rows.find((x) => x.id === f.id)!
    return r.error ? `error` : `${r.approved ? 'approve' : 'to staff'} (${r.verdict}, ${r.confidence?.toFixed(2)})`
  })
  detail += `| ${f.id}: ${f.why} | ${f.expected === 'ok' ? 'approve' : 'to staff'} | ${cells.join(' | ')} |\n`
}

const report = `# AI document check: model evaluation, ${today}

Made-up documents only (${set.length}: ${set.filter((f) => f.expected === 'ok').length} fine, ${set.filter((f) => f.expected === 'problem').length} with one clear problem: name mismatch, expired, wrong type, unreadable, cropped). No real person or document. The same client, prompt and decision rule as the app: a document is approved by the AI only when the verdict is "ok", the confidence is at least ${min}, the type and name match and it is not expired. A failed call counts as "to staff".

## Result

${table}
A false approval (a problem document the AI would approve) is the costly mistake; a false rejection only costs a person's time. The 10 percent spot check is not part of this table.

## Per document

${detail}
## Notes for the decision

- The sample is small (${set.length} documents per model): it separates clearly weak models from usable ones, it does not prove an error rate.
- Check on OpenRouter that the chosen model has an endpoint that satisfies the privacy routing (no data collection, zero data retention); the app sends both settings and does not fall back to other providers, so a model without such an endpoint fails every call and every document goes to staff.
- Set the winner as AI_DOCUMENT_MODEL in Vercel (Production and Preview) together with OPENROUTER_API_KEY. Cost per document times the expected uploads gives the monthly figure for AI_MONTHLY_CAP_EUR.
`
mkdirSync(REPORTS, { recursive: true })
const file = join(REPORTS, `ai-document-check-evaluation-${today}.md`)
writeFileSync(file, report)
console.log(`\n${table}\nReport written to ${file}`)
