import { api } from '@/api/client'
import { deleteAccount, getExport } from './account'

jest.mock('@/api/client', () => ({ ...jest.requireActual('@/api/client'), api: jest.fn() }))

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
  expect(api).toHaveBeenCalledWith('/app-api/v1/me', { method: 'DELETE', body: { confirmEmail: 'a@b.de' }, timeLimit: 60_000 })
})
test('an empty export answer is a failed read', async () => {
  ;(api as jest.Mock).mockResolvedValueOnce(null)
  await expect(getExport()).rejects.toMatchObject({ status: 0, code: 'network' })
  ;(api as jest.Mock).mockResolvedValueOnce('')
  await expect(getExport('csv')).rejects.toMatchObject({ code: 'network' })
})

test('the delete has its own 60 second time limit', async () => {
  await deleteAccount('a@b.de')
  expect(api).toHaveBeenCalledWith('/app-api/v1/me', { method: 'DELETE', body: { confirmEmail: 'a@b.de' }, timeLimit: 60_000 })
})
