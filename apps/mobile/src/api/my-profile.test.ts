import { api, ApiError, upload } from '@/api/client'
import { documentsApi } from './my-profile'

jest.mock('@/api/client', () => {
  const actual = jest.requireActual('@/api/client')
  return { ...actual, api: jest.fn(), upload: jest.fn() }
})

const file = { uri: 'file:///c.pdf', name: 'c.pdf', type: 'application/pdf' }

beforeEach(() => {
  ;(upload as jest.Mock).mockReset().mockResolvedValue({ id: 7 })
  ;(api as jest.Mock).mockReset()
})

test('a failed check after the upload deletes the uploaded file and reports the original error', async () => {
  const failure = new ApiError(500, 'HTTP 500')
  ;(api as jest.Mock).mockRejectedValueOnce(failure).mockResolvedValueOnce(undefined)
  await expect(documentsApi.submit(file, 'police-certificate')).rejects.toBe(failure)
  expect(api).toHaveBeenLastCalledWith('/app-api/v1/files/7', { method: 'DELETE' })
})

test('a successful submit deletes nothing', async () => {
  ;(api as jest.Mock).mockResolvedValueOnce({ id: 1 })
  await documentsApi.submit(file, 'police-certificate')
  expect(api).toHaveBeenCalledTimes(1)
})

test('a failing clean-up does not hide the original error', async () => {
  const failure = new ApiError(0, 'network')
  ;(api as jest.Mock).mockRejectedValueOnce(failure).mockRejectedValueOnce(new ApiError(0, 'network'))
  await expect(documentsApi.submit(file, 'police-certificate')).rejects.toBe(failure)
})
