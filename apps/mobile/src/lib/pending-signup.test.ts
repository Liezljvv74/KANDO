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
  const noPicture = { ...p, pictureUri: null }

  it('keeps nothing when the Terms and the picture are done', () => {
    expect(nextPending(p, { termsOpen: false, pictureDone: true })).toBeNull()
  })
  it('keeps nothing when there is no picture to upload and the Terms are done', () => {
    expect(nextPending(noPicture, { termsOpen: false, pictureDone: false })).toBeNull()
  })
  it('keeps only the picture while it is not uploaded', () => {
    expect(nextPending(p, { termsOpen: false, pictureDone: false })).toEqual({ email: p.email, offerServices: true, pictureUri: 'file:///p.jpg' })
  })
  it('keeps only the Terms when the picture is done', () => {
    expect(nextPending(p, { termsOpen: true, pictureDone: true })).toEqual({ email: p.email, offerServices: true, pictureUri: null, termsAccepted: true })
  })
  it('keeps both when both are open', () => {
    expect(nextPending(p, { termsOpen: true, pictureDone: false })).toEqual({ email: p.email, offerServices: true, pictureUri: 'file:///p.jpg', termsAccepted: true })
  })
  it('never keeps the names or the address, so a retry cannot overwrite later edits', () => {
    const kept = nextPending(p, { termsOpen: true, pictureDone: false })
    expect(kept).not.toHaveProperty('firstName')
    expect(kept).not.toHaveProperty('address')
  })
})
