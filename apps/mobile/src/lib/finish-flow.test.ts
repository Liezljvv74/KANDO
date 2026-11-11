import { Alert } from 'react-native'
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
test("provider no: goes to /my-profile with { publish: '1' }", () => {
  finishFlow('provider')
  buttons()[1].onPress()
  expect(goReplace).toHaveBeenCalledWith('/my-profile', { publish: '1' })
})
