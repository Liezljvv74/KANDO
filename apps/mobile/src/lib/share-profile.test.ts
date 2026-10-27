import { Share } from 'react-native'

import { API_URL } from '@/api/client'
import { providerUrl, shareProfile } from './share-profile'

const base = API_URL.replace(/\/$/, '')

test('the provider page url carries the language only when it is not the default', () => {
  expect(providerUrl('anna-berg', 'de')).toBe(`${base}/providers/anna-berg`)
  expect(providerUrl('anna-berg', 'en')).toBe(`${base}/providers/anna-berg?lang=en`)
})

test('shareProfile passes the url and the text in the given language', async () => {
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction, activityType: undefined })
  await shareProfile('https://x.de/providers/a', 'de')
  expect(share).toHaveBeenCalledWith({ message: 'Finde mich bei SkillWeb: https://x.de/providers/a', url: 'https://x.de/providers/a' })
  await shareProfile('https://x.de/providers/a?lang=en', 'en')
  expect(share).toHaveBeenLastCalledWith({ message: 'Find me on SkillWeb: https://x.de/providers/a?lang=en', url: 'https://x.de/providers/a?lang=en' })
})
