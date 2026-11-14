import { useMe } from '@/hooks/use-me'
import { useSession } from '@/hooks/use-session'
import { readyToNavigate, usePending } from '@/lib/pending-navigation'
import HomeScreen from '@/screens/home/home-screen'

// The Home tab is the Home screen for everyone: signed out it is the first screen of the app (the Welcome look), signed in the same choices.
// Blank for the moment before the tabs layout opens the page a new provider is on the way to (the setup page): no flash of Home.
export default function Index() {
  const { user } = useSession()
  const me = useMe()
  const leaving = readyToNavigate(usePending(), me, !!user)
  return leaving ? null : <HomeScreen />
}
