import { Alert } from 'react-native'

import { confirmSignOut } from '@/lib/confirm-sign-out'
import * as store from '@/lib/pending-saves'

jest.mock('@/i18n', () => ({ t: (k: string) => k }))
jest.mock('@/lib/pending-saves', () => ({ listEntries: jest.fn(), dropAccount: jest.fn() }))

const list = jest.mocked(store.listEntries)
const drop = jest.mocked(store.dropAccount)
const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {})
const press = (label: string) => alert.mock.calls[0][2]!.find((b) => b.text === label)!.onPress?.()

beforeEach(() => jest.clearAllMocks())

describe('confirmSignOut', () => {
  it('signs out without a question when the account has nothing unsaved', () => {
    list.mockReturnValue([])
    const signOut = jest.fn()
    confirmSignOut('a', signOut)
    expect(list).toHaveBeenCalledWith('a')
    expect(alert).not.toHaveBeenCalled()
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(drop).not.toHaveBeenCalled()
  })

  it('asks first, and Stay does nothing', () => {
    list.mockReturnValue([{ key: 'k' } as never])
    const signOut = jest.fn()
    confirmSignOut('a', signOut)
    expect(alert.mock.calls[0][0]).toBe('pending.signOutAsk')
    press('pending.signOutStay')
    expect(signOut).not.toHaveBeenCalled()
    expect(drop).not.toHaveBeenCalled()
  })

  it('on confirm drops this account, then signs out', () => {
    list.mockReturnValue([{ key: 'k' } as never])
    const signOut = jest.fn()
    confirmSignOut('a', signOut)
    press('pending.signOutYes')
    expect(drop).toHaveBeenCalledWith('a')
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(drop.mock.invocationCallOrder[0]).toBeLessThan(signOut.mock.invocationCallOrder[0])
  })

  it('on confirm signs out once even when the changes were sent meanwhile', () => {
    list.mockReturnValue([{ key: 'k' } as never])
    const signOut = jest.fn()
    confirmSignOut('a', signOut)
    list.mockReturnValue([])
    press('pending.signOutYes')
    expect(signOut).toHaveBeenCalledTimes(1)
  })
})
