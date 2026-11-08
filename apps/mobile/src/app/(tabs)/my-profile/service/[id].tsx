import { useLocalSearchParams } from 'expo-router'

import ServiceScreen from '@/screens/my-profile/service-screen'

export default function EditService() {
  return <ServiceScreen id={useLocalSearchParams<{ id: string }>().id} />
}
