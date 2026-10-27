import { clearPending, loadPending, savePending, type PendingSignup } from './pending-signup'

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
