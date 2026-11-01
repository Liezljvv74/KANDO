// The keyboard library needs its native module; tests get the library's own mock instead.
jest.mock('react-native-keyboard-controller', () => require('react-native-keyboard-controller/jest'))
// The date and time picker needs its native module; the pure logic around it is what the tests cover.
jest.mock('@react-native-community/datetimepicker', () => ({ __esModule: true, default: () => null, DateTimePickerAndroid: { open: jest.fn() } }))
