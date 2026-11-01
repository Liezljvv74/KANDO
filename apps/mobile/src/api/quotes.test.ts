import { api } from '@/api/client'
import { listQuoteDocuments, quotePdf } from './quotes'

jest.mock('@/api/client', () => ({ ...jest.requireActual('@/api/client'), api: jest.fn() }))

beforeEach(() => (api as jest.Mock).mockReset().mockResolvedValue({ docs: [] }))
const last = () => (api as jest.Mock).mock.calls.at(-1)

test('the list reads /quotes and returns its docs', async () => {
  ;(api as jest.Mock).mockResolvedValueOnce({ docs: [{ id: 'd1' }] })
  expect(await listQuoteDocuments()).toEqual([{ id: 'd1' }])
  expect(last()).toEqual(['/app-api/v1/quotes'])
})

test('the PDF link is read per document id, the id encoded', async () => {
  ;(api as jest.Mock).mockResolvedValue({ url: 'https://files.test/q.pdf' })
  expect(await quotePdf('a b')).toEqual({ url: 'https://files.test/q.pdf' })
  expect(last()).toEqual(['/app-api/v1/quotes/a%20b/pdf'])
})
