import { getMe, setOnTermsRequired } from '@/api/client'
import { clearMe, currentMe, ensureMe, loadMe, noteQuoteSteps, unseenOf } from './use-me'

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

test('two consumers of useQuoteSteps trigger one request (the first load is shared), and a held /me makes none', async () => {
  clearMe()
  jest.mocked(getMe).mockReset().mockResolvedValue({ id: 'p', quoteSteps: ['consent'], notifications: [] } as never)
  await Promise.all([ensureMe(), ensureMe()])
  expect(getMe).toHaveBeenCalledTimes(1)
  await ensureMe()
  expect(getMe).toHaveBeenCalledTimes(1)
})

test('a saved profile updates the held quote steps without a request; nothing is invented before /me arrives', async () => {
  clearMe()
  noteQuoteSteps([])
  expect(currentMe()).toBeNull()
  jest.mocked(getMe).mockReset().mockResolvedValue({ id: 'p', quoteSteps: ['consent', 'taxId'], notifications: [] } as never)
  await ensureMe()
  noteQuoteSteps(['taxId'])
  expect(currentMe()?.quoteSteps).toEqual(['taxId'])
  expect(getMe).toHaveBeenCalledTimes(1)
})

test('unseenOf keeps only notifications without a seenAt and copes with no list', () => {
  expect(unseenOf([{ seenAt: null }, { seenAt: 'x' }])).toEqual([{ seenAt: null }])
  expect(unseenOf([{ seenAt: 'x' }])).toEqual([])
  expect(unseenOf(undefined)).toEqual([])
})
