import { Stack } from 'expo-router'

// The stack always has My business at the bottom, so a step opened from outside (the flow) has it underneath.
export const unstable_settings = { initialRouteName: 'index' }

export default function MyProfileLayout() {
  return <Stack screenOptions={{ headerShown: false }} />
}
