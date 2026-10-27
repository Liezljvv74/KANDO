import { useLocalSearchParams } from 'expo-router'

import ReferenceScreen from '@/screens/my-profile/reference-screen'

export default function EditReference() {
  return <ReferenceScreen id={useLocalSearchParams<{ id: string }>().id} />
}
