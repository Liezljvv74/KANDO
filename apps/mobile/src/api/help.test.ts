import { api } from '@/api/client'
import { getHelpTopics } from './help'

jest.mock('@/api/client', () => ({ api: jest.fn() }))

test('asks for the topics in the given language', async () => {
  ;(api as jest.Mock).mockResolvedValue([])
  await getHelpTopics('en')
  expect(api).toHaveBeenCalledWith('/app-api/v1/help?lang=en')
})

import { searchHelpTopics } from './help'

test('search sends the encoded text and language and returns the topics', async () => {
  ;(api as jest.Mock).mockResolvedValue({ topics: [{ slug: 'a' }] })
  expect(await searchHelpTopics('Rück & mehr', 'de')).toEqual([{ slug: 'a' }])
  expect(api).toHaveBeenLastCalledWith('/app-api/v1/help/search?q=R%C3%BCck%20%26%20mehr&lang=de')
})
