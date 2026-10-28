import { photoMenu } from './photo-menu'

test('with a picture: iOS has four buttons ending in Cancel', () => {
  expect(photoMenu('ios', true)).toEqual(['take', 'choose', 'remove', 'cancel'])
})

test('with a picture: Android keeps three buttons (its Alert drops the rest) and the menu is dismissed by tapping outside', () => {
  expect(photoMenu('android', true)).toEqual(['take', 'choose', 'remove'])
})

test('without a picture: Take, Choose, Cancel on both platforms', () => {
  expect(photoMenu('ios', false)).toEqual(['take', 'choose', 'cancel'])
  expect(photoMenu('android', false)).toEqual(['take', 'choose', 'cancel'])
})
