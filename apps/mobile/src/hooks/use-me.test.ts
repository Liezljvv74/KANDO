import { getMe, setOnTermsRequired } from '@/api/client'
import { clearMe, currentMe, loadMe, unseenOf } from './use-me'

jest.mock('@/api/client', () => ({ getMe: jest.fn(), setOnTermsRequired: jest.fn() }))
// Taken at load, before any test clears the mock.
const onTermsRequired = jest.mocked(setOnTermsRequired).mock.calls[0]?.[0]
jest.mock('@/api/my-profile', () => ({ notificationsApi: { mark: jest.fn() } }))

test('a loadMe in flight at sign-out never fills the store for the next account', async () => {
  let resolve!: (m: unknown) => void
  jest.mocked(getMe).mockReturnValue(new Promise((r) => (resolve = r)) as never)
  const loading = loadMe()
  clearMe()
  resolve({ id: 'a', notifications: [{ id: 'n1' }] })
  await loading
  expect(currentMe()).toBeNull()
})

test('the newest loadMe wins: an older, slower response never overwrites a newer one', async () => {
  const resolvers: ((m: unknown) => void)[] = []
  jest.mocked(getMe).mockImplementation(() => new Promise((r) => resolvers.push(r)) as never)
  const older = loadMe()
  const newer = loadMe()
  resolvers[1]({ id: 'new', notifications: [] })
  await newer
  resolvers[0]({ id: 'old', notifications: [] })
  await older
  expect(currentMe()?.id).toBe('new')
})

test('a refused write (428 terms-required) reloads /me, whose termsRequired shows the accept pop-up', async () => {
  expect(onTermsRequired).toBeInstanceOf(Function)
  jest.mocked(getMe).mockResolvedValue({ id: 'a', termsRequired: true, notifications: [] } as never)
  onTermsRequired!()
  await new Promise((r) => setTimeout(r, 0))
  expect(currentMe()?.termsRequired).toBe(true)
})

test('unseenOf keeps only notifications without a seenAt and copes with no list', () => {
  expect(unseenOf([{ seenAt: null }, { seenAt: 'x' }])).toEqual([{ seenAt: null }])
  expect(unseenOf([{ seenAt: 'x' }])).toEqual([])
  expect(unseenOf(undefined)).toEqual([])
})
