import { emailMatches, exportText } from './account-data'

test('the typed email must equal the account email, ignoring case and outer spaces', () => {
  expect(emailMatches('Anna@Example.com ', 'anna@example.com')).toBe(true)
  expect(emailMatches('anna@example.co', 'anna@example.com')).toBe(false)
  expect(emailMatches('', 'anna@example.com')).toBe(false)
  expect(emailMatches('anna@example.com', '')).toBe(false) // no email known yet: never enabled
})

test('the export text is readable JSON of the whole document', () => {
  const text = exportText({ user: { email: 'a@b.de' } })
  expect(text).toContain('\n  "user"')
  expect(JSON.parse(text)).toEqual({ user: { email: 'a@b.de' } })
})


test('a CSV export is shared as it is', () => {
  const csv = 'section,record\r\nuser,1'
  expect(exportText(csv)).toBe(csv)
})
