import { Stack } from 'expo-router'

import { signedInOnly } from '@/components/signed-in-only'

// The stack always has My business at the bottom, so a step opened from outside (the flow) has it underneath.
export const unstable_settings = { initialRouteName: 'index' }

function MyProfileLayout() {
  return <Stack screenOptions={{ headerShown: false }} />
}

export default signedInOnly(MyProfileLayout, 'tab.myProfile')
