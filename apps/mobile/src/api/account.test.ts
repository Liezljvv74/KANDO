import { api } from '@/api/client'
import { deleteAccount, getExport } from './account'

jest.mock('@/api/client', () => ({ api: jest.fn() }))

beforeEach(() => (api as jest.Mock).mockReset().mockResolvedValue({}))

test('the export is a GET of /me/export', async () => {
  await getExport()
  expect(api).toHaveBeenCalledWith('/app-api/v1/me/export')
})

test('the CSV export is read as text from ?format=csv', async () => {
  await getExport('csv')
  expect(api).toHaveBeenCalledWith('/app-api/v1/me/export?format=csv', { text: true })
})

test('the delete sends the typed email as the JSON body of a DELETE /me', async () => {
  await deleteAccount('a@b.de')
  expect(api).toHaveBeenCalledWith('/app-api/v1/me', { method: 'DELETE', body: { confirmEmail: 'a@b.de' } })
})
