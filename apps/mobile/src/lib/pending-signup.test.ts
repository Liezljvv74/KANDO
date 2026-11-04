jest.mock('expo-secure-store', () => ({ setItemAsync: jest.fn(), deleteItemAsync: jest.fn(), getItemAsync: jest.fn() }))

import { nextPending, type PendingSignup } from './pending-signup'

const p: PendingSignup = { email: 'a@test.invalid', firstName: 'Anna', lastName: 'Beispiel', offerServices: true, termsAccepted: true, pictureUri: 'file:///x.jpg' }

describe('nextPending', () => {
  it.each([
    ['nothing left', { termsOpen: false, pictureLeft: false }, null],
    ['only the picture left', { termsOpen: false, pictureLeft: true }, { email: p.email, offerServices: true, pictureUri: 'file:///x.jpg' }],
    ['only the Terms left', { termsOpen: true, pictureLeft: false }, { email: p.email, offerServices: true, pictureUri: null, termsAccepted: true }],
    ['both left', { termsOpen: true, pictureLeft: true }, { email: p.email, offerServices: true, pictureUri: 'file:///x.jpg', termsAccepted: true }],
  ])('%s', (_name, left, expected) => {
    expect(nextPending(p, left)).toEqual(expected)
  })

  it('never keeps the names or the address, so a retry cannot overwrite later edits', () => {
    const kept = nextPending({ ...p, address: { street: 'a' } as never }, { termsOpen: true, pictureLeft: true })
    expect(kept).not.toHaveProperty('firstName')
    expect(kept).not.toHaveProperty('address')
  })
})
