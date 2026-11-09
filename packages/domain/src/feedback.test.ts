import { expect, it } from 'vitest'
import { buildFeedbackMail, FEEDBACK_SUBJECT, FEEDBACK_TO, ipHashOf } from './feedback'

it('the mail goes to the fixed address with replyTo the sender, and escapes the message in the HTML part', () => {
  const m = buildFeedbackMail({ email: 'a@b.de', message: '<script>alert("x")</script> & more' }, null)
  expect(m.to).toBe(FEEDBACK_TO)
  expect(m.replyTo).toBe('a@b.de')
  expect(m.subject).toBe(FEEDBACK_SUBJECT)
  expect(m.html).not.toContain('<script>')
  expect(m.html).toContain('&lt;script&gt;')
  expect(m.html).toContain('&amp; more')
  expect(m.text).toContain('<script>') // plain text part stays as written
})

it('CR and LF never reach a header (replyTo, subject)', () => {
  const m = buildFeedbackMail({ email: 'a@b.de\r\nBcc: x@y.de', message: 'hi' }, null)
  expect(m.replyTo).not.toMatch(/[\r\n]/)
  expect(m.subject).not.toMatch(/[\r\n]/)
})

it('a signed-in mail adds the user id and language, a signed-out one adds nothing personal', () => {
  const m = buildFeedbackMail({ email: 'a@b.de', message: 'hi' }, { id: 'u1', language: 'de' })
  expect(m.text).toContain('User id: u1')
  expect(m.text).toContain('App language: de')
  expect(buildFeedbackMail({ email: 'a@b.de', message: 'hi' }, null).text).not.toContain('User id')
})

it('the address is hashed, never kept raw', () => {
  const h = ipHashOf(new Headers({ 'x-vercel-forwarded-for': '203.0.113.9, 10.0.0.1' }))
  expect(h).toMatch(/^[0-9a-f]{64}$/)
  expect(h).not.toContain('203')
  expect(ipHashOf(new Headers({ 'x-vercel-forwarded-for': '203.0.113.10' }))).not.toBe(h)
})
