import { api } from '@/api/client'
import { getHelpTopics } from './help'

jest.mock('@/api/client', () => ({ api: jest.fn() }))

test('asks for the topics in the given language', async () => {
  ;(api as jest.Mock).mockResolvedValue([])
  await getHelpTopics('en')
  expect(api).toHaveBeenCalledWith('/app-api/v1/help?lang=en')
})
