import { afterEach, expect, it, vi } from 'vitest'
import { clearOutbox, outboxForTests, sendEmail } from '@kando/domain'

afterEach(() => clearOutbox())

it('approval: one email in the user language with the document name and the deep link', async () => {
  await sendEmail({ to: 'a@test.skilled.invalid', lang: 'en', template: 'document-approved', params: { requirement: 'police-certificate' } })
  const [m, ...rest] = outboxForTests()
  expect(rest).toHaveLength(0)
  expect(m).toMatchObject({ to: 'a@test.skilled.invalid', from: 'SkillWeb <noreply@skillweb.space>', replyTo: 'info@skillweb.space' })
  expect(m!.subject).toBe('Your document has been approved')
  expect(m!.text).toContain('Police certificate')
  expect(m!.text).toContain('skillweb://my-profile')
  expect(m!.html).toContain('Police certificate')
})

it('rejection in German includes the note verbatim, escaped in the HTML', async () => {
  await sendEmail({ to: 'b@test.skilled.invalid', lang: 'de', template: 'document-rejected', params: { requirement: 'permit', note: 'Unleserlich <b>"&"</b>' } })
  const [m] = outboxForTests()
  expect(m!.subject).toBe('Dein Dokument wurde abgelehnt')
  expect(m!.text).toContain('Genehmigung')
  expect(m!.text).toContain('Unleserlich <b>"&"</b>')
  expect(m!.html).toContain('Unleserlich &lt;b&gt;&quot;&amp;&quot;&lt;/b&gt;')
  expect(m!.html).not.toContain('<b>')
})

it('without a key it only logs and records, and never throws', async () => {
  vi.stubEnv('RESEND_API_KEY', '')
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  await expect(sendEmail({ to: 'c@test.skilled.invalid', lang: 'en', template: 'document-approved', params: { requirement: 'permit' } })).resolves.toBeUndefined()
  expect(outboxForTests()).toHaveLength(1)
  expect(log).toHaveBeenCalled()
  log.mockRestore()
  vi.unstubAllEnvs()
})
