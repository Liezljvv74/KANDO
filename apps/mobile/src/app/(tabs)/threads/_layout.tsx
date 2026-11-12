import { Stack } from 'expo-router'

import { signedInOnly } from '@/components/signed-in-only'

function ThreadsLayout() {
  return <Stack screenOptions={{ headerShown: false }} />
}

export default signedInOnly(ThreadsLayout, 'tab.jobs')
