import { Stack } from 'expo-router'

import { signedInOnly } from '@/components/signed-in-only'

function InvoicesLayout() {
  return <Stack screenOptions={{ headerShown: false }} />
}

export default signedInOnly(InvoicesLayout, 'tab.jobs')
