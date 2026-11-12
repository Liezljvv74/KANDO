import { Redirect } from 'expo-router'

import { useSession } from '@/hooks/use-session'
import HomeScreen from '@/screens/home/home-screen'

// Signed out, the Home tab is the Welcome screen (the first screen of the app); signed in it is the Home screen.
export default function Index() {
  const { user } = useSession()
  return user ? <HomeScreen /> : <Redirect href="/welcome" />
}
