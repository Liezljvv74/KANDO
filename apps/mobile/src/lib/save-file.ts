import { Platform } from 'react-native'

/** True where a file can be saved straight to the device's downloads (the web build); the phone apps use the share sheet. */
export const canDownload = Platform.OS === 'web' && typeof document !== 'undefined'

/** Saves a text as a file through the browser's download (web only; nothing leaves the device). */
export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
