import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { pool } from '@kando/db'
import { clearOutbox, notifyDocumentDecision, outboxForTests, sendEmail } from '@kando/domain'
import { EMAIL, seedUser } from './helpers'

const send = vi.hoisted(() => vi.fn())
vi.mock('resend', () => ({ Resend: class { emails = { send } } }))

beforeEach(() => vi.stubEnv('RESEND_API_KEY', ''))
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  send.mockReset()
  clearOutbox()
})

it('approval: one email in the user language with the document name and the deep link', async () => {
  await sendEmail({ to: 'a@test.skilled.invalid', lang: 'en', template: 'document-approved', params: { requirement: 'police-certificate' } })
  const [m, ...rest] = outboxForTests()
  expect(rest).toHaveLength(0)
  expect(m).toMatchObject({ to: 'a@test.skilled.invalid', from: 'SkillWeb <noreply@skillweb.space>', replyTo: 'info@skillweb.space' })
  expect(m!.subject).toBe('Your document has been approved')
  expect(m!.text).toContain('Police certificate')
  expect(m!.text).toContain('skilled://my-profile')
  expect(m!.html).toContain('Police certificate')
})

it('rejection in German includes the note verbatim, escaped in the HTML', async () => {
  await sendEmail({ to: 'b@test.skilled.invalid', lang: 'de', template: 'document-rejected', params: { requirement: 'permit', note: 'Unleserlich <b>"&"</b>\nZeile 2' } })
  const [m] = outboxForTests()
  expect(m!.subject).toBe('Dein Dokument wurde abgelehnt')
  expect(m!.text).toContain('Genehmigung')
  expect(m!.text).toContain('Unleserlich <b>"&"</b>')
  expect(m!.html).toContain('Unleserlich &lt;b&gt;&quot;&amp;&quot;&lt;/b&gt;')
  expect(m!.html).not.toContain('<b>')
  expect(m!.html).toContain('&lt;/b&gt;<br>Zeile 2')
})

it('without a key it only logs and records, and never throws', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  await expect(sendEmail({ to: 'c@test.skilled.invalid', lang: 'en', template: 'document-approved', params: { requirement: 'permit' } })).resolves.toBeUndefined()
  expect(outboxForTests()).toHaveLength(1)
  expect(log).toHaveBeenCalled()
})

it('outside tests without a key: one log line without recipient or body, and nothing kept in memory', async () => {
  vi.stubEnv('VITEST', '')
  vi.stubEnv('NODE_ENV', 'production')
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  await sendEmail({ to: 'd@test.skilled.invalid', lang: 'de', template: 'document-rejected', params: { requirement: 'permit', note: 'secret note' } })
  expect(outboxForTests()).toHaveLength(0)
  expect(log).toHaveBeenCalledTimes(1)
  const line = log.mock.calls[0]!.join(' ')
  expect(line).toContain('[email] not sent (no RESEND_API_KEY)')
  expect(line).not.toContain('d@test.skilled.invalid')
  expect(line).not.toContain('secret note')
})

it('with a key it calls Resend with the full message; an { error } and a throw are logged, not thrown', async () => {
  vi.stubEnv('RESEND_API_KEY', 're_test')
  const err = vi.spyOn(console, 'error').mockImplementation(() => {})
  const args = { to: 'd@test.skilled.invalid', lang: 'en' as const, template: 'document-approved' as const, params: { requirement: 'permit' } }
  send.mockResolvedValueOnce({ error: { name: 'validation_error' } })
  await expect(sendEmail(args)).resolves.toBeUndefined()
  expect(send).toHaveBeenCalledWith({
    from: 'SkillWeb <noreply@skillweb.space>',
    to: 'd@test.skilled.invalid',
    replyTo: 'info@skillweb.space',
    subject: 'Your document has been approved',
    text: expect.stringContaining('Permit'),
    html: expect.stringContaining('Permit'),
  })
  expect(err).toHaveBeenCalledTimes(1)
  send.mockRejectedValueOnce(new Error('network down'))
  await expect(sendEmail(args)).resolves.toBeUndefined()
  expect(err).toHaveBeenCalledTimes(2)
  expect(outboxForTests()).toHaveLength(0)
})

it('an unexpected stored language falls back to German', async () => {
  await seedUser('em-lang')
  await pool.query("UPDATE users SET language = 'xx' WHERE id = 'em-lang'")
  await notifyDocumentDecision('em-lang', { id: 'x', requirement: 'permit', status: 'approved', note: null })
  expect(outboxForTests().map((m) => [m.to, m.subject])).toEqual([[EMAIL('em-lang'), 'Dein Dokument wurde freigegeben']])
  await pool.query("DELETE FROM users WHERE id = 'em-lang'")
})
