import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { asUser, pool } from '@kando/db'
import { AiUnavailable, ID_DOCUMENT, openRouterChecker, runDocumentCheck, stripPersonalData, sweepIdImages, type DocumentCheckOutput, type DocumentChecker } from '@kando/domain'
import { setDocumentCheckerForTests, setStorageForTests } from '@kando/domain/src/testing'
import { adminCall, call, cleanupUsers, EMAIL, memoryStorage, profile, seedUser, sized } from './helpers'

vi.mock('../lib/auth/server', async () => ({ ...(await (await import('./helpers')).mockAuth()), sessionFromRequest: (await import('./helpers')).fakeSession }))
const review = await import('../app/api/admin/documents/[id]/review/route')
const item = await import('../app/api/admin/[resource]/[id]/route')
const profileRoute = await import('../app/app-api/v1/provider-profile/route')
const files = await import('../app/app-api/v1/files/route')
const verifications = await import('../app/app-api/v1/verifications/route')

const store = memoryStorage()
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n')
const OK = { verdict: 'ok', reasons: 'ok', documentTypeMatches: true, nameMatches: true, notExpired: true, confidence: 0.95 } as const

type Result = DocumentCheckOutput['result']
/** A fake model: answers `answer` (or throws it), remembers what it was asked. Never reaches the network. */
function fake(answer: Partial<Result> | Error, costUsd: number | null = 0.01) {
  const asked: Parameters<DocumentChecker['check']>[0][] = []
  const checker: DocumentChecker = {
    model: 'fake/model',
    async check(input) {
      asked.push(input)
      if (answer instanceof Error) throw answer
      return { result: { ...OK, ...answer }, costUsd, tokens: 1000 }
    },
  }
  return { checker, asked }
}
let n = 0
/** A user with a name, a pending document and (optionally) its stored object. */
async function pendingDoc(requirement = 'police-certificate', name: string | null = 'Anna Muster') {
  const uid = `ai${++n}`
  await seedUser(uid, null, name)
  const key = `documents/${uid}/d.pdf`
  store.objects.set(`documents/${key}`, PDF)
  const id = (await pool.query("INSERT INTO documents (owner_id, requirement, key) VALUES ($1, $2, $3) RETURNING id", [uid, requirement, key])).rows[0].id as string
  return { uid, id, key }
}
const check = async (id: string) => (await pool.query('SELECT * FROM document_ai_checks WHERE document_id = $1', [id])).rows[0]
const status = async (id: string) => (await pool.query('SELECT status, reviewed_by, reviewed_at FROM documents WHERE id = $1', [id])).rows[0]

beforeAll(() => setStorageForTests(store))
afterAll(async () => {
  setStorageForTests(undefined)
  await cleanupUsers()
})
beforeEach(() => {
  vi.stubEnv('RESEND_API_KEY', '')
  vi.stubEnv('AI_MIN_CONFIDENCE', '')
  vi.stubEnv('AI_MONTHLY_CAP_EUR', '')
})
afterEach(() => {
  setDocumentCheckerForTests(undefined)
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

it('key missing: the feature is off, nothing is asked, the document waits for staff as before', async () => {
  vi.stubEnv('OPENROUTER_API_KEY', '')
  vi.stubEnv('AI_DOCUMENT_MODEL', '')
  const d = await pendingDoc()
  expect(await runDocumentCheck(d.id)).toBe('off')
  expect(await check(d.id)).toBeUndefined()
  expect((await status(d.id)).status).toBe('pending')
})

it('a mistyped provider pin switches the check off instead of widening where documents go', async () => {
  vi.stubEnv('OPENROUTER_API_KEY', 'test-key-not-real')
  vi.stubEnv('AI_DOCUMENT_MODEL', 'x/y')
  vi.stubEnv('AI_DOCUMENT_PROVIDER', 'google vertex!')
  const d = await pendingDoc()
  expect(await runDocumentCheck(d.id)).toBe('off')
  expect((await status(d.id)).status).toBe('pending')
  vi.stubEnv('AI_DOCUMENT_PROVIDER', '')
})

it('the translate key alone does not switch it on: a model must be chosen too', async () => {
  vi.stubEnv('OPENROUTER_API_KEY', 'test-key-not-real')
  vi.stubEnv('AI_DOCUMENT_MODEL', '')
  const d = await pendingDoc()
  expect(await runDocumentCheck(d.id)).toBe('off')
  expect(await check(d.id)).toBeUndefined()
})

it('approve path: no problem, sure enough, not sampled: approved by the AI, only verdict and confidence stored', async () => {
  const f = fake(OK)
  const d = await pendingDoc('id-document')
  vi.spyOn(Math, 'random').mockReturnValue(0.5)
  expect(await runDocumentCheck(d.id, { checker: f.checker })).toBe('auto-approved')
  expect(await status(d.id)).toMatchObject({ status: 'approved', reviewed_by: null })
  expect((await status(d.id)).reviewed_at).not.toBeNull()
  expect(await check(d.id)).toMatchObject({ verdict: 'ok', confidence: 0.95, decision: 'auto-approved', sampled: false, explanation: null, failure: null, model: 'fake/model', staff_decision: null })
  expect(Number((await check(d.id)).cost_eur)).toBeCloseTo(0.01)
  expect(f.asked).toHaveLength(1)
  expect(f.asked[0]).toMatchObject({ mime: 'application/pdf', names: ['Anna Muster'] })
})

it('problem path: the document goes to staff with a clean explanation (no numbers, no dates)', async () => {
  const f = fake({ verdict: 'problem', nameMatches: false, reasons: 'Name does not match. Document no. 123456789, born 01.02.1990 and 5 March 1988, tel +49 170 1234567.' })
  const d = await pendingDoc('id-document')
  expect(await runDocumentCheck(d.id, { checker: f.checker })).toBe('sent-to-staff')
  expect((await status(d.id)).status).toBe('pending')
  const row = await check(d.id)
  expect(row).toMatchObject({ verdict: 'problem', decision: 'sent-to-staff', sampled: false })
  expect(row.explanation).toBe('Name does not match. Document no. [number], born [date] and [date], tel +[number].')
  expect(row.explanation).not.toMatch(/\d{6}/)
})

it('low confidence: staff decide, the reason is kept', async () => {
  const f = fake({ confidence: 0.79, reasons: 'Slightly blurry' })
  const d = await pendingDoc()
  expect(await runDocumentCheck(d.id, { checker: f.checker })).toBe('sent-to-staff')
  expect(await check(d.id)).toMatchObject({ verdict: 'ok', decision: 'sent-to-staff', explanation: 'Slightly blurry' })
  vi.stubEnv('AI_MIN_CONFIDENCE', '0.5') // the threshold is a setting
  const e = await pendingDoc()
  expect(await runDocumentCheck(e.id, { checker: f.checker, random: () => 0.9 })).toBe('auto-approved')
})

it('a flag the AI itself raised blocks approval even when it says ok', async () => {
  const d = await pendingDoc()
  expect(await runDocumentCheck(d.id, { checker: fake({ notExpired: false }).checker })).toBe('sent-to-staff')
  const e = await pendingDoc()
  expect(await runDocumentCheck(e.id, { checker: fake({ notExpired: null }).checker, random: () => 0.9 })).toBe('auto-approved') // no expiry date shown is fine
})

it('spot check: 10 percent of the approvals, drawn after the decision, for every type; it reverses to staff and keeps no explanation', async () => {
  for (const requirement of ['id-document', 'liability-insurance']) {
    const hit = await pendingDoc(requirement)
    expect(await runDocumentCheck(hit.id, { checker: fake(OK).checker, random: () => 0.0999 })).toBe('sent-to-staff')
    expect(await check(hit.id)).toMatchObject({ verdict: 'ok', decision: 'sent-to-staff', sampled: true, explanation: null })
    expect((await status(hit.id)).status).toBe('pending')
    const miss = await pendingDoc(requirement)
    expect(await runDocumentCheck(miss.id, { checker: fake(OK).checker, random: () => 0.1 })).toBe('auto-approved')
    expect((await check(miss.id)).sampled).toBe(false)
  }
  // a problem is not drawn at all: it goes to staff anyway
  const d = await pendingDoc()
  const draw = vi.fn(() => 0)
  await runDocumentCheck(d.id, { checker: fake({ verdict: 'problem' }).checker, random: draw })
  expect(draw).not.toHaveBeenCalled()
  expect((await check(d.id)).sampled).toBe(false)
})

it('a failing provider, a timeout and a bad answer never block: the document waits for staff', async () => {
  const cases: [Error, string, boolean][] = [
    [new AiUnavailable('error', 'AI service answered 500'), 'error', false],
    [new AiUnavailable('timeout', 'AI service timed out'), 'timeout', true],
    [new Error('something with ID 123456789 in it'), 'error', false],
  ]
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
  for (const [err, failure, billed] of cases) {
    const d = await pendingDoc()
    expect(await runDocumentCheck(d.id, { checker: fake(err).checker })).toBe('sent-to-staff')
    expect(await check(d.id)).toMatchObject({ verdict: null, decision: 'sent-to-staff', failure, explanation: null })
    expect(Number((await check(d.id)).cost_eur) > 0).toBe(billed)
    expect((await status(d.id)).status).toBe('pending')
  }
  expect(logged.mock.calls.flat().join(' ')).not.toContain('123456789')
})

it('a person without a name cannot be matched: staff decide, nothing is sent', async () => {
  const f = fake(OK)
  const d = await pendingDoc('permit', null)
  expect(await runDocumentCheck(d.id, { checker: f.checker })).toBe('sent-to-staff')
  expect(f.asked).toHaveLength(0)
  expect((await check(d.id)).failure).toBe('no-name')
})

it('the monthly cost cap: when it is reached nothing is asked and the document goes to staff; the next month starts again', async () => {
  vi.stubEnv('AI_MONTHLY_CAP_EUR', '1')
  const spender = await pendingDoc()
  await pool.query("INSERT INTO document_ai_checks (document_id, model, cost_eur, decision, finished_at) VALUES ($1, 'm', 1, 'sent-to-staff', now())", [spender.id])
  const f = fake(OK)
  const d = await pendingDoc()
  expect(await runDocumentCheck(d.id, { checker: f.checker })).toBe('sent-to-staff')
  expect(f.asked).toHaveLength(0)
  expect((await check(d.id)).failure).toBe('cap')
  const next = new Date()
  next.setUTCMonth(next.getUTCMonth() + 1)
  const g = await pendingDoc()
  expect(await runDocumentCheck(g.id, { checker: f.checker, now: next, random: () => 0.9 })).toBe('auto-approved')
})

it('the monthly cap counts what each call cost (a missing cost falls back to a token estimate)', async () => {
  const d = await pendingDoc()
  await runDocumentCheck(d.id, { checker: fake(OK, null).checker, random: () => 0.9 })
  expect(Number((await check(d.id)).cost_eur)).toBeCloseTo(1000 * 0.00002)
})

it('rate limit: ten checks per person and hour, then staff decide', async () => {
  const first = await pendingDoc()
  for (let i = 0; i < 10; i++) {
    const old = (await pool.query("INSERT INTO documents (owner_id, requirement, key, status) VALUES ($1, 'permit', 'documents/x.pdf', 'rejected') RETURNING id", [first.uid])).rows[0].id
    await pool.query("INSERT INTO document_ai_checks (document_id, model, decision, finished_at) VALUES ($1, 'm', 'sent-to-staff', now())", [old])
  }
  const f = fake(OK)
  expect(await runDocumentCheck(first.id, { checker: f.checker })).toBe('sent-to-staff')
  expect(f.asked).toHaveLength(0)
  expect((await check(first.id)).failure).toBe('rate-limit')
  // an hour later the same person is allowed again; another person was never limited
  const second = await pendingDoc()
  expect(await runDocumentCheck(second.id, { checker: f.checker, random: () => 0.9 })).toBe('auto-approved')
})

it('idempotent: a second run of the same document does nothing', async () => {
  const f = fake(OK)
  const d = await pendingDoc()
  const runs = await Promise.all([runDocumentCheck(d.id, { checker: f.checker, random: () => 0.9 }), runDocumentCheck(d.id, { checker: f.checker, random: () => 0.9 })])
  expect(runs.sort()).toEqual(['auto-approved', 'skipped'])
  expect(await runDocumentCheck(d.id, { checker: f.checker })).toBe('skipped')
  expect(f.asked).toHaveLength(1)
  expect((await pool.query('SELECT count(*)::int AS n FROM document_ai_checks WHERE document_id = $1', [d.id])).rows[0].n).toBe(1)
})

it('a document staff already decided is not approved over their head', async () => {
  const d = await pendingDoc()
  const slow: DocumentChecker = {
    model: 'fake/model',
    async check() {
      await pool.query("UPDATE documents SET status = 'rejected', note = 'no' WHERE id = $1", [d.id])
      return { result: { ...OK }, costUsd: 0, tokens: 1 }
    },
  }
  expect(await runDocumentCheck(d.id, { checker: slow, random: () => 0.9 })).toBe('sent-to-staff')
  expect((await status(d.id)).status).toBe('rejected')
  expect((await check(d.id)).failure).toBe('staff-decided')
})

it('through the upload route: the check runs after the submit, the answer stays 201 with a pending document, and an approval refreshes nothing it should not', async () => {
  setDocumentCheckerForTests(fake(OK).checker)
  vi.spyOn(Math, 'random').mockReturnValue(0.5)
  const uid = 'ai-route'
  await call(profileRoute.PUT, uid, 'PUT', profile)
  await pool.query("UPDATE users SET first_name = 'Rea', last_name = 'Route' WHERE id = $1", [uid])
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(PDF)]), 'u.pdf')
  const up = await files.POST(await sized(new Request('http://localhost/x', { method: 'POST', headers: { origin: 'http://localhost', cookie: `uid=${uid}:${EMAIL(uid)}` }, body: form })), { params: Promise.resolve({}) })
  expect(up.status).toBe(201)
  const res = await call(verifications.POST, uid, 'POST', { requirement: 'police-certificate', document: (await up.json()).id })
  expect(res.status).toBe(201)
  const row = (await pool.query("SELECT d.status, c.decision FROM documents d JOIN document_ai_checks c ON c.document_id = d.id WHERE d.owner_id = $1", [uid])).rows[0]
  expect(row).toEqual({ status: 'approved', decision: 'auto-approved' })
  // what the person sees is unchanged: no AI field in the list
  const list = await (await call(verifications.GET, uid)).json()
  expect(JSON.stringify(list)).not.toMatch(/ai|verdict|confidence|explanation/i)
})

it('staff see the suggestion next to the document; the staff decision is logged beside it', async () => {
  await seedUser('ai-staff', 'reviewer')
  const d = await pendingDoc('id-document')
  await runDocumentCheck(d.id, { checker: fake({ verdict: 'problem', reasons: 'Looks expired', notExpired: false, confidence: 0.7 }).checker })
  const shown = await (await adminCall(item.GET, 'ai-staff', 'GET', '/x', undefined, { resource: 'documents', id: d.id })).json()
  expect(shown.data.ai).toMatchObject({ verdict: 'problem', explanation: 'Looks expired', decision: 'sent-to-staff', sampled: false, model: 'fake/model', staffDecision: null })
  expect(shown.data.imageDeletedAt).toBeNull()
  expect((await adminCall(review.POST, 'ai-staff', 'POST', '/x', { decision: 'rejected', note: 'Expired' }, { id: d.id })).status).toBe(200)
  expect((await check(d.id)).staff_decision).toBe('rejected')
  expect((await pool.query('SELECT reviewed_by FROM documents WHERE id = $1', [d.id])).rows[0].reviewed_by).toBe('ai-staff') // who decided
  const plain = await pendingDoc() // no check: the panel says so
  expect((await (await adminCall(item.GET, 'ai-staff', 'GET', '/x', undefined, { resource: 'documents', id: plain.id })).json()).data.ai).toBeNull()
})

it('row-level security: the provider, even the owner of the document, cannot read or write the results', async () => {
  const d = await pendingDoc()
  await runDocumentCheck(d.id, { checker: fake({ verdict: 'problem' }).checker })
  await expect(asUser(d.uid, (tx) => tx.execute('SELECT * FROM document_ai_checks'))).rejects.toMatchObject({ cause: { message: expect.stringMatching(/permission denied/) } })
  await expect(asUser(d.uid, (tx) => tx.execute("UPDATE document_ai_checks SET verdict = 'ok'"))).rejects.toMatchObject({ cause: { message: expect.stringMatching(/permission denied/) } })
  await expect(asUser(d.uid, (tx) => tx.execute("UPDATE documents SET image_deleted_at = now()"))).rejects.toMatchObject({ cause: { message: expect.stringMatching(/permission denied/) } })
  const { rows } = await pool.query("SELECT has_table_privilege('app_user', 'document_ai_checks', 'SELECT') AS r")
  expect(rows[0].r).toBe(false)
})

it('deleting a document deletes its AI result with it', async () => {
  const d = await pendingDoc()
  await runDocumentCheck(d.id, { checker: fake({ verdict: 'problem' }).checker })
  await pool.query('DELETE FROM documents WHERE id = $1', [d.id])
  expect(await check(d.id)).toBeUndefined()
})

const day = 86_400_000
/** An ID (or other) document whose AI check finished at `finished`, with its object in the store. */
async function checkedDoc(requirement: string, status: string, finished: Date, reviewedAt: Date | null = null) {
  const d = await pendingDoc(requirement)
  await pool.query('UPDATE documents SET status = $2, reviewed_at = $3 WHERE id = $1', [d.id, status, reviewedAt])
  await pool.query("INSERT INTO document_ai_checks (document_id, model, decision, finished_at) VALUES ($1, 'm', 'auto-approved', $2)", [d.id, finished])
  return d
}

it('retention: a photo ID image is deleted 30 days after the check, not before, and only that', async () => {
  await pool.query("DELETE FROM documents WHERE requirement = 'id-document'") // earlier tests' IDs would be swept by the far-future dates below
  const base = new Date('2030-01-01T10:00:00Z')
  const id = await checkedDoc(ID_DOCUMENT, 'approved', base)
  const other = await checkedDoc('liability-insurance', 'approved', base)
  const pendingId = await checkedDoc(ID_DOCUMENT, 'pending', base)
  const noCheck = await pendingDoc(ID_DOCUMENT) // feature was off for it
  await pool.query("UPDATE documents SET status = 'approved' WHERE id = $1", [noCheck.id])
  const staffLater = await checkedDoc(ID_DOCUMENT, 'rejected', base, new Date(base.getTime() + 20 * day)) // staff decided on day 20
  const exists = (d: { key: string }) => store.objects.has(`documents/${d.key}`)

  expect(await sweepIdImages(new Date(base.getTime() + 30 * day - 1000))).toBe(0) // day 29.99: nothing
  expect(exists(id)).toBe(true)
  expect(await sweepIdImages(new Date(base.getTime() + 30 * day))).toBe(1)
  expect(exists(id)).toBe(false)
  expect((await pool.query('SELECT image_deleted_at FROM documents WHERE id = $1', [id.id])).rows[0].image_deleted_at).not.toBeNull()
  for (const kept of [other, pendingId, noCheck, staffLater]) expect(exists(kept)).toBe(true)
  expect(await sweepIdImages(new Date(base.getTime() + 60 * day))).toBe(1) // the staff-decided one: day 20 + 30
  expect(exists(staffLater)).toBe(false)
  expect(exists(pendingId)).toBe(true) // still waiting for a person
  expect(await sweepIdImages(new Date(base.getTime() + 90 * day))).toBe(0) // each only once
})

it('retention: a failing storage delete leaves the row for the next day', async () => {
  await pool.query("DELETE FROM documents WHERE requirement = 'id-document'")
  const base = new Date('2031-01-01T10:00:00Z')
  const d = await checkedDoc(ID_DOCUMENT, 'approved', base)
  const down = { ...store, delete: () => Promise.reject(new Error('storage down')) }
  setStorageForTests(down)
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
  expect(await sweepIdImages(new Date(base.getTime() + 31 * day))).toBe(0)
  expect(logged.mock.calls.flat().join(' ')).not.toContain(d.key)
  setStorageForTests(store)
  expect((await pool.query('SELECT image_deleted_at FROM documents WHERE id = $1', [d.id])).rows[0].image_deleted_at).toBeNull()
  expect(await sweepIdImages(new Date(base.getTime() + 32 * day))).toBe(1)
})

it('the daily route runs the sweep', async () => {
  vi.stubEnv('CRON_SECRET', 's3cret')
  const cron = await import('../app/api/cron/suspensions/route')
  const base = new Date(Date.now() - 40 * day)
  const d = await checkedDoc(ID_DOCUMENT, 'approved', base)
  const body = await (await cron.GET(new Request('http://localhost/api/cron/suspensions', { headers: { authorization: 'Bearer s3cret' } }))).json()
  expect(body.idImages).toBeGreaterThanOrEqual(1)
  expect(store.objects.has(`documents/${d.key}`)).toBe(false)
})

it('a deleted ID image: the person gets a clean 404 for the link, the export says the image is gone', async () => {
  const base = new Date(Date.now() - 40 * day)
  const d = await checkedDoc(ID_DOCUMENT, 'approved', base)
  await sweepIdImages()
  const fileRoute = await import('../app/app-api/v1/files/[id]/route')
  expect((await call(fileRoute.GET, d.uid, 'GET', undefined, { id: d.id })).status).toBe(404)
  const exportRoute = await import('../app/app-api/v1/me/export/route')
  const body = await (await call(exportRoute.GET, d.uid)).json()
  expect(body.documents[0]).toMatchObject({ requirement: ID_DOCUMENT, downloadUrl: null, imageDeletedAt: expect.any(String) })
  expect(body.aiDocumentChecks).toEqual([{ requirement: ID_DOCUMENT, documentCreatedAt: expect.any(String), verdict: null, confidence: null, decision: 'auto-approved', explanation: null, checkedAt: expect.any(String) }])
  const admin = await (await adminCall(item.GET, 'ai-staff', 'GET', '/x', undefined, { resource: 'documents', id: d.id })).json()
  expect(admin.data).toMatchObject({ link: null, imageDeletedAt: expect.any(String) })
})

it('stripPersonalData: dates and long digit runs go, short numbers stay, the length is capped', () => {
  expect(stripPersonalData('Expired on 31.12.2020')).toBe('Expired on [date]')
  expect(stripPersonalData('born 1990-02-01 / 02/03/89')).toBe('born [date] / [date]')
  expect(stripPersonalData('ID L01X00T47 and C01X00T47 no 1234 5678 9')).toBe('ID L01X00T47 and C01X00T47 no [number]')
  expect(stripPersonalData('Page 2 of 3, 12 digits 123456789012')).toBe('Page 2 of 3, 12 digits [number]')
  expect(stripPersonalData('x'.repeat(1000))).toHaveLength(300)
})

it('the OpenRouter client: privacy options, key in the header only, validated answer, cost, and errors without content', async () => {
  const seen: { url: string; init: RequestInit }[] = []
  const answer = (body: unknown, ok = true) => vi.fn(async (url: string | URL | Request, init?: RequestInit) => (seen.push({ url: String(url), init: init! }), { ok, status: ok ? 200 : 502, json: async () => body }) as Response)
  const good = answer({ choices: [{ message: { content: '```json\n' + JSON.stringify(OK) + '\n```' } }], usage: { cost: 0.0042, total_tokens: 900 } })
  const input = { bytes: PDF, mime: 'application/pdf', documentType: 'photo ID', names: ['Anna Muster'], today: '2026-11-03' }
  const out = await openRouterChecker({ apiKey: 'k-test', model: 'x/y', fetchImpl: good as unknown as typeof fetch }).check(input)
  expect(out).toEqual({ result: OK, costUsd: 0.0042, tokens: 900 })
  const sent = JSON.parse(seen[0]!.init.body as string)
  expect(seen[0]!.url).toBe('https://openrouter.ai/api/v1/chat/completions')
  expect(sent.provider).toEqual({ data_collection: 'deny', zdr: true, allow_fallbacks: false })
  expect(sent.model).toBe('x/y')
  const pinned = answer({ choices: [{ message: { content: JSON.stringify(OK) } }] })
  await openRouterChecker({ apiKey: 'k', model: 'x/y', provider: 'google-vertex', fetchImpl: pinned as unknown as typeof fetch }).check(input)
  expect(JSON.parse(seen[seen.length - 1]!.init.body as string).provider).toEqual({ data_collection: 'deny', zdr: true, allow_fallbacks: false, only: ['google-vertex'] })
  expect(sent.messages[1].content[1]).toMatchObject({ type: 'file', file: { file_data: expect.stringMatching(/^data:application\/pdf;base64,/) } })
  expect((seen[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer k-test')
  expect(JSON.stringify(sent)).not.toContain('k-test')
  const png = answer({ choices: [{ message: { content: JSON.stringify(OK) } }] })
  await openRouterChecker({ apiKey: 'k', model: 'm', fetchImpl: png as unknown as typeof fetch }).check({ ...input, mime: 'image/png' })
  expect(JSON.parse(seen[2]!.init.body as string).messages[1].content[1]).toMatchObject({ type: 'image_url' })

  const bad = (body: unknown, ok = true) => openRouterChecker({ apiKey: 'k', model: 'm', fetchImpl: answer(body, ok) as unknown as typeof fetch }).check(input)
  await expect(bad({ choices: [{ message: { content: JSON.stringify({ ...OK, confidence: 7 }) } }] })).rejects.toBeInstanceOf(AiUnavailable) // fails the shape
  await expect(bad({ choices: [{ message: { content: 'not json 123456789' } }] })).rejects.toThrow('AI call failed') // no content in the message
  await expect(bad({}, false)).rejects.toThrow('AI service answered 502')
  const slow = openRouterChecker({ apiKey: 'k', model: 'm', timeoutMs: 5, fetchImpl: ((_u: string, init: RequestInit) => new Promise((_r, rej) => init.signal!.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' }))))) as unknown as typeof fetch })
  await expect(slow.check(input)).rejects.toMatchObject({ reason: 'timeout' })
})
