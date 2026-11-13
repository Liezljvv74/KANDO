import { Alert } from 'react-native'
import { t } from '@/i18n'
import { goReplace } from './go'
import { finishFlow } from './finish-flow'

jest.mock('./go', () => ({ goReplace: jest.fn() }))
jest.spyOn(Alert, 'alert').mockImplementation(() => {})

const buttons = () => (Alert.alert as jest.Mock).mock.calls[0][2] as { onPress: () => void }[]
beforeEach(() => jest.clearAllMocks())

test('customer: goes to /search', () => {
  finishFlow('customer')
  expect(goReplace).toHaveBeenCalledWith('/search')
})
test('provider yes: goes to /my-profile', () => {
  finishFlow('provider')
  buttons()[0].onPress()
  expect(goReplace).toHaveBeenCalledWith('/my-profile')
})
test("provider no: goes to /my-profile with a publish param", () => {
  finishFlow('provider')
  buttons()[1].onPress()
  expect(goReplace).toHaveBeenCalledWith('/my-profile', { publish: expect.any(String) })
})
test('provider with payouts not finished: never says everything is done; offers My business or publishing', () => {
  finishFlow('provider', true)
  const [title, text] = (Alert.alert as jest.Mock).mock.calls[0] as string[]
  expect(title).toBe(t('flow.almostDone'))
  expect(text).toBe(t('flow.payoutNotReady'))
  expect(title).not.toBe(t('flow.allDone'))
  buttons()[0].onPress()
  expect(goReplace).toHaveBeenLastCalledWith('/my-profile')
  buttons()[1].onPress()
  expect(goReplace).toHaveBeenLastCalledWith('/my-profile', { publish: expect.any(String) })
})
test('a customer is never told about payouts', () => {
  finishFlow('customer', true)
  expect(Alert.alert).toHaveBeenCalledWith(t('flow.allDone'), t('flow.customerDone'))
})
