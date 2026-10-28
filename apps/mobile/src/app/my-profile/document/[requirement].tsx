import { useLocalSearchParams } from 'expo-router'

import DocumentScreen from '@/screens/my-profile/document-screen'

export default function EditDocument() {
  return <DocumentScreen requirement={useLocalSearchParams<{ requirement: string }>().requirement} />
}
