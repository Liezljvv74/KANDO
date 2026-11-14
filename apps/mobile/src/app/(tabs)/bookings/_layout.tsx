import { Stack } from 'expo-router'

import { signedInOnly } from '@/components/signed-in-only'

function BookingsLayout() {
  return <Stack screenOptions={{ headerShown: false }} />
}

export default signedInOnly(BookingsLayout, 'tab.jobs')
