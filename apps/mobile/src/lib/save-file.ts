import { Directory } from 'expo-file-system'
import { Platform } from 'react-native'

/**
 * Saves a text as a file the person can keep. Web: the browser's download. Phone: the system's folder picker, then the file is
 * written there (nothing leaves the device). Returns false when the person closed the picker without choosing a folder.
 */
export async function downloadText(filename: string, text: string, type = 'text/csv'): Promise<boolean> {
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }))
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    return true
  }
  let folder: Directory
  try {
    folder = await Directory.pickDirectoryAsync()
  } catch {
    return false // the picker was closed
  }
  try {
    folder.createFile(filename, type).write(text)
  } catch {
    // the name is taken in that folder (a second export): save beside it under a new name
    folder.createFile(filename.replace(/(\.[^.]*)?$/, `-${Date.now()}$1`), type).write(text)
  }
  return true
}
