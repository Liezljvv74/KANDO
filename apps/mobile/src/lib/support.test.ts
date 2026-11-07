import { supportMailto } from './support'

test('the mail goes to support with the job number and title encoded', () => {
  const url = supportMailto({ number: 1042, title: 'Fix & paint "door"' }, 'en')
  expect(url.startsWith('mailto:info@skillweb.space?subject=')).toBe(true)
  const q = new URLSearchParams(url.split('?')[1])
  expect(q.get('subject')).toBe('Help with job #1042: Fix & paint "door"')
  expect(q.get('body')).toContain('#1042')
  expect(url).not.toMatch(/ |"/)
})

test('German subject', () => {
  expect(new URLSearchParams(supportMailto({ number: 7, title: 'Garten' }, 'de').split('?')[1]).get('subject')).toBe('Hilfe zu Auftrag #7: Garten')
})
