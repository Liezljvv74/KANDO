import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { pool } from '@kando/db'
import { MeSchema } from '@kando/contract'
import { clearOutbox, notifyDocumentDecision, outboxForTests } from '@kando/domain'
import { call, cleanupUsers, seedBase, seedProvider } from './helpers'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const meRoute = await import('../app/app-api/v1/me/route')
const notif = await import('../app/app-api/v1/notifications/[id]/route')

let docCategoryId: string
let multiId: string
beforeAll(async () => {
  ;({ docCategoryId } = await seedBase())
  await pool.query("INSERT INTO category_texts (category_id, lang, name) VALUES ($1, 'de', 'Betreuung'), ($1, 'en', 'Care')", [docCategoryId])
  multiId = (await pool.query("INSERT INTO categories (slug, required_documents) VALUES ($1, ARRAY['police-certificate','permit']) RETURNING id", [`nt-multi-${Date.now()}`])).rows[0].id
})
beforeEach(() => {
  vi.stubEnv('RESEND_API_KEY', '')
  vi.stubEnv('NEXT_PUBLIC_SERVER_URL', 'https://kando.example')
  clearOutbox()
})
afterAll(async () => {
  await cleanupUsers()
  await pool.query('DELETE FROM services WHERE category_id = $1', [multiId])
  await pool.query('DELETE FROM categories WHERE id = $1', [multiId])
})

/** A provider with a service needing the police certificate; approves it the way the review does, then runs the after-commit mail. */
async function decide(uid: string, o: { status?: string; suspended?: boolean; lang?: string; extra?: boolean; earlier?: boolean; decision?: 'approved' | 'rejected' } = {}) {
  await seedProvider(uid, { name: uid, categoryId: docCategoryId, status: o.status, suspended: o.suspended })
  await pool.query('UPDATE users SET language = $2 WHERE id = $1', [uid, o.lang ?? 'de'])
  if (o.extra) await pool.query("INSERT INTO services (provider_id, category_id, title, price_type) SELECT id, $2, 'Two', 'on-request' FROM providers WHERE owner_id = $1", [uid, multiId])
  if (o.earlier) await pool.query("INSERT INTO documents (owner_id, requirement, key, status) VALUES ($1, 'police-certificate', 'k0', 'approved')", [uid])
  const d = o.decision ?? 'approved'
  await pool.query("INSERT INTO documents (owner_id, requirement, key, status, note) VALUES ($1, 'police-certificate', 'k1', $2, $3)", [uid, d, d === 'rejected' ? 'blurry' : null])
  await notifyDocumentDecision(uid, { id: 'x', requirement: 'police-certificate', status: d, note: d === 'rejected' ? 'blurry' : null })
  return outboxForTests().map((m) => m.subject)
}
const rows = async (uid: string) => (await pool.query('SELECT kind, payload FROM notifications WHERE user_id = $1', [uid])).rows

it('live and nothing else pending: "profile is live" email with the link, and one notification', async () => {
  expect(await decide('nt-live', { lang: 'en' })).toEqual(['Your profile is live'])
  expect(outboxForTests()[0]!.text).toContain('https://kando.example/providers/nt-live-slug?lang=en')
  expect(await rows('nt-live')).toEqual([{ kind: 'profile-live', payload: { url: 'https://kando.example/providers/nt-live-slug?lang=en' } }])
})

it('the link of a German provider has no lang parameter', async () => {
  await decide('nt-de')
  expect((await rows('nt-de'))[0].payload.url).toBe('https://kando.example/providers/nt-de-slug')
})

it('live but another document is still missing: says the category service is visible, no notification', async () => {
  await decide('nt-more', { lang: 'en', extra: true })
  expect(outboxForTests()[0]!.text).toContain('Your Care service is now visible.')
  expect(await rows('nt-more')).toEqual([])
})

it('draft profile: offline text, no notification', async () => {
  await decide('nt-draft', { status: 'draft', lang: 'en' })
  expect(outboxForTests()[0]!.text).toContain('Your profile is offline at the moment')
  expect(await rows('nt-draft')).toEqual([])
})

it('suspended profile: suspended text with the date, no notification', async () => {
  await decide('nt-susp', { suspended: true, lang: 'en' })
  const date = new Date(Date.now() + 86400000).toLocaleDateString('en-GB')
  expect(outboxForTests()[0]!.text).toContain(`suspended until ${date}`)
  expect(await rows('nt-susp')).toEqual([])
})

it('a requirement that was already approved: plain approval, no notification', async () => {
  expect(await decide('nt-twice', { earlier: true, lang: 'en' })).toEqual(['Your document has been approved'])
  expect(outboxForTests()[0]!.text).toContain('Police certificate')
  expect(await rows('nt-twice')).toEqual([])
})

it('rejection is unchanged', async () => {
  expect(await decide('nt-rej', { decision: 'rejected', lang: 'en' })).toEqual(['Your document was rejected'])
  expect(await rows('nt-rej')).toEqual([])
})

it('GET /me lists the notification; PATCH dismissed hides it; another user gets 404', async () => {
  await decide('nt-api')
  await call(meRoute.GET, 'nt-other')
  const me = MeSchema.parse(await (await call(meRoute.GET, 'nt-api')).json())
  expect(me.notifications).toHaveLength(1)
  const id = me.notifications[0]!.id
  expect((await call(notif.PATCH, 'nt-other', 'PATCH', { dismissed: true }, { id })).status).toBe(404)
  expect((await call(notif.PATCH, 'nt-api', 'PATCH', { seen: true }, { id })).status).toBe(204)
  expect(MeSchema.parse(await (await call(meRoute.GET, 'nt-api')).json()).notifications[0]!.seenAt).not.toBeNull()
  expect((await call(notif.PATCH, 'nt-api', 'PATCH', { dismissed: true }, { id })).status).toBe(204)
  expect(MeSchema.parse(await (await call(meRoute.GET, 'nt-api')).json()).notifications).toEqual([])
})
