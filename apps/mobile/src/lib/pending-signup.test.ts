import { clearPending, loadPending, nextPending, savePending, type PendingSignup } from './pending-signup'

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>()
  return {
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => void store.set(k, v)),
    deleteItemAsync: jest.fn(async (k: string) => void store.delete(k)),
  }
})

const rec: PendingSignup = {
  email: 'a@b.de',
  firstName: 'Anna',
  lastName: 'Berg',
  offerServices: true,
  pictureUri: 'file:///p.jpg',
  address: { street: 'Weg 1', postcode: '10115', city: 'Berlin', country: 'DE' },
}

test('the pending record round-trips and clears', async () => {
  expect(await loadPending()).toBeNull()
  await savePending(rec)
  expect(await loadPending()).toEqual(rec)
  await clearPending()
  expect(await loadPending()).toBeNull()
})

describe('nextPending', () => {
  const p: PendingSignup = { ...rec, termsAccepted: true }
  it.each([
    ['nothing left', { termsOpen: false, pictureLeft: false }, null],
    ['only the picture left', { termsOpen: false, pictureLeft: true }, { email: p.email, offerServices: true, pictureUri: 'file:///p.jpg' }],
    ['only the Terms left', { termsOpen: true, pictureLeft: false }, { email: p.email, offerServices: true, pictureUri: null, termsAccepted: true }],
    ['both left', { termsOpen: true, pictureLeft: true }, { email: p.email, offerServices: true, pictureUri: 'file:///p.jpg', termsAccepted: true }],
  ])('%s', (_name, left, expected) => {
    expect(nextPending(p, left)).toEqual(expected)
  })

  it('never keeps the names or the address, so a retry cannot overwrite later edits', () => {
    const kept = nextPending(p, { termsOpen: true, pictureLeft: true })
    expect(kept).not.toHaveProperty('firstName')
    expect(kept).not.toHaveProperty('address')
  })
})
