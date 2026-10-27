import { pictureNudgeKey } from './picture-nudge'

test('the dismissed-nudge key is per user, so a second account on the device still sees it', () => {
  expect(pictureNudgeKey('u1')).toBe('skilled.pictureNudgeDismissed.u1')
  expect(pictureNudgeKey('u1')).not.toBe(pictureNudgeKey('u2'))
})
