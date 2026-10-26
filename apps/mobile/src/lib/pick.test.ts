import { ImageManipulator } from 'expo-image-manipulator'
import { DOCUMENT_TYPES, MAX_UPLOAD_FILE_BYTES, pickDocument, pickPhoto, preparePhoto, tooLarge } from './pick'

jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: { manipulate: jest.fn() },
}))
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
}))
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }))

const resize = jest.fn()
const saveAsync = jest.fn(async () => ({ uri: 'file:///out.jpg' }))
beforeEach(() => {
  resize.mockReset()
  ;(ImageManipulator.manipulate as jest.Mock).mockReturnValue({ resize, renderAsync: async () => ({ saveAsync }) })
})

test('preparePhoto keeps the long side at 1600 px', async () => {
  await preparePhoto('file:///a.jpg', 4000, 3000)
  expect(resize).toHaveBeenCalledWith({ width: 1600 })
  resize.mockReset()
  await preparePhoto('file:///b.jpg', 3000, 4000)
  expect(resize).toHaveBeenCalledWith({ height: 1600 })
  resize.mockReset()
  await expect(preparePhoto('file:///c.jpg', 1200, 900)).resolves.toMatchObject({ type: 'image/jpeg' })
  expect(resize).not.toHaveBeenCalled()
  expect(saveAsync).toHaveBeenCalledWith({ compress: 0.8, format: 'jpeg' })
})

test('tooLarge is true above 4_434_464 bytes', () => {
  const f = { uri: 'u', name: 'n', type: 't' }
  expect(MAX_UPLOAD_FILE_BYTES).toBe(4_434_464)
  expect(tooLarge({ ...f, size: 4_434_464 })).toBe(false)
  expect(tooLarge({ ...f, size: 4_434_465 })).toBe(true)
})

describe('pickPhoto', () => {
  const picker = jest.requireMock('expo-image-picker')
  const grant = (granted: boolean) => {
    picker.requestCameraPermissionsAsync.mockResolvedValue({ granted })
    picker.launchCameraAsync.mockClear().mockResolvedValue({ canceled: true })
  }

  test('cancelled is null', async () => {
    grant(true)
    await expect(pickPhoto('camera', false)).resolves.toBeNull()
  })

  test('a refused permission is denied, not cancelled', async () => {
    grant(false)
    await expect(pickPhoto('camera', false)).resolves.toBe('denied')
    expect(picker.launchCameraAsync).not.toHaveBeenCalled()
  })
})

describe('pickDocument', () => {
  const picker = jest.requireMock('expo-document-picker')

  test('offers PDFs and the image types the server accepts, from any file source', async () => {
    picker.getDocumentAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'content://drive/x', name: 'cert.png', size: 10, mimeType: 'image/png' }] })
    await expect(pickDocument()).resolves.toEqual({ uri: 'content://drive/x', name: 'cert.png', size: 10, type: 'image/png' })
    expect(picker.getDocumentAsync).toHaveBeenCalledWith({ type: DOCUMENT_TYPES, copyToCacheDirectory: false })
    expect(DOCUMENT_TYPES).toEqual(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
  })

  test('cancelled is null', async () => {
    picker.getDocumentAsync.mockResolvedValue({ canceled: true })
    await expect(pickDocument()).resolves.toBeNull()
  })
})
