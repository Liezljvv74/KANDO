import { ApiError } from '@/api/client'
import { afterDeleteFailure, emailMatches, exportText } from './account-data'

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

const ok = async () => ({})
const gone = async () => {
  throw new ApiError(401, 'Unauthorized')
}
const down = async () => {
  throw new ApiError(0, 'network')
}

test('a refused delete (400, 409) says it was not deleted and does not ask the server again', async () => {
  const check = jest.fn(ok)
  expect(await afterDeleteFailure(new ApiError(409, 'LAST_ADMIN'), check)).toMatchObject({ deleted: false })
  expect(await afterDeleteFailure(new ApiError(400, 'EMAIL_MISMATCH'), check)).toMatchObject({ deleted: false })
  expect(check).not.toHaveBeenCalled()
})

test('no answer or a server error: a 401 from the check means deleted', async () => {
  expect(await afterDeleteFailure(new ApiError(0, 'network'), gone)).toEqual({ deleted: true })
  expect(await afterDeleteFailure(new ApiError(502, 'HTTP 502'), gone)).toEqual({ deleted: true })
})

test('no answer or a server error: an account that still answers, or a check that fails too, is unconfirmed, never "not deleted"', async () => {
  for (const check of [ok, down]) {
    const r = await afterDeleteFailure(new ApiError(0, 'network'), check)
    expect(r).toMatchObject({ deleted: false })
    expect((r as { text: string }).text).toContain('confirm')
    expect((r as { text: string }).text).not.toContain('was not deleted')
  }
})

test('a 401 on the delete itself means the account is already gone', async () => {
  expect(await afterDeleteFailure(new ApiError(401, 'Unauthorized'), ok)).toEqual({ deleted: true })
})

