// The keyboard library needs its native module; tests get the library's own mock instead.
jest.mock('react-native-keyboard-controller', () => require('react-native-keyboard-controller/jest'))
