import * as DocumentPicker from 'expo-document-picker'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import * as ImagePicker from 'expo-image-picker'
import { ApiError, type PickedFile } from '@/api/client'

export const MAX_PHOTO_SIDE = 1600
/** The server's body cap (4.5 MB) minus 64 KB for the multipart envelope. */
export const MAX_UPLOAD_FILE_BYTES = 4_500_000 - 64 * 1024
export const tooLarge = (file: PickedFile) => (file.size ?? 0) > MAX_UPLOAD_FILE_BYTES

/** Resizes so the long side is at most MAX_PHOTO_SIDE and re-encodes as JPEG (also turns HEIC into JPEG). */
export async function preparePhoto(uri: string, width: number, height: number): Promise<PickedFile> {
  const ctx = ImageManipulator.manipulate(uri)
  if (Math.max(width, height) > MAX_PHOTO_SIDE) ctx.resize(width >= height ? { width: MAX_PHOTO_SIDE } : { height: MAX_PHOTO_SIDE })
  const out = await (await ctx.renderAsync()).saveAsync({ compress: 0.8, format: SaveFormat.JPEG })
  return { uri: out.uri, name: 'photo.jpg', type: 'image/jpeg' }
}

/** What a failed pick or upload shows: the API's own code, else the file could not be read or converted. */
export const uploadErrorCode = (e: unknown) => {
  // The screen shows a short message; the real cause goes to the developer's terminal.
  if (__DEV__) console.warn('upload failed:', e)
  return e instanceof ApiError ? e.code : 'Unsupported file type'
}

/** null when cancelled, 'denied' when the permission was refused. `square` crops to 1:1 (the profile photo). */
export async function pickPhoto(source: 'camera' | 'library', square: boolean): Promise<PickedFile | null | 'denied'> {
  const camera = source === 'camera'
  const perm = await (camera ? ImagePicker.requestCameraPermissionsAsync() : ImagePicker.requestMediaLibraryPermissionsAsync())
  if (!perm.granted) return 'denied'
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: square, aspect: square ? [1, 1] : undefined }
  const res = await (camera ? ImagePicker.launchCameraAsync(opts) : ImagePicker.launchImageLibraryAsync(opts))
  if (res.canceled) return null
  const { uri, width, height } = res.assets[0]
  return preparePhoto(uri, width, height)
}

// Same list as the server's PRIVATE_FILE_MIME_TYPES. The system file picker also shows Downloads, Google Drive, OneDrive etc.
export const DOCUMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']

/** A verification document (PDF or image) from the phone's files or cloud storage; null when cancelled. */
export async function pickDocument(): Promise<PickedFile | null> {
  // No copy: the picker copies into Expo Go's shared cache, which the upload may not read ("Missing 'READ' permission").
  // The picked content:// link (OneDrive, Downloads, ...) is read directly instead.
  const res = await DocumentPicker.getDocumentAsync({ type: DOCUMENT_TYPES, copyToCacheDirectory: false })
  if (res.canceled) return null
  const { uri, name, size, mimeType } = res.assets[0]
  // The server sniffs the real type from the bytes; this is only a label.
  return { uri, name, size, type: mimeType ?? 'application/pdf' }
}
