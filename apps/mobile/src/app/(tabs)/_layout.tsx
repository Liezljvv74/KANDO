import { router, Tabs } from 'expo-router'
import { useEffect } from 'react'
import { AppState } from 'react-native'

import { loadMe, useMe } from '@/hooks/use-me'
import { t, useLang } from '@/i18n'
import { consumePending, readyToNavigate, urlOf, usePending } from '@/lib/pending-navigation'
import { showProfileTab } from '@/lib/profile-tab'

export default function TabsLayout() {
  useLang()
  const me = useMe()
  // "Offer services": go to the profile page only once this layout has rendered with the tab visible.
  const pending = usePending()
  useEffect(() => {
    if (!readyToNavigate(pending, me)) return // the target stays until the tab is visible
    const p = consumePending()
    if (p) router.navigate(urlOf(p))
  }, [me, pending])
  // A notification created while the app was in the background shows its dot as soon as the user returns.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && loadMe().catch(() => {}))
    return () => sub.remove()
  }, [])
  // A dot (empty badge) while any notification is unseen; opening My service profile marks them seen.
  const unseen = me?.notifications.some((n) => !n.seenAt)
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: '#0E8A6B', tabBarInactiveTintColor: '#5C7A72' }}>
      <Tabs.Screen name="index" options={{ title: t('tab.home') }} />
      <Tabs.Screen name="search" options={{ title: t('tab.search') }} />
      <Tabs.Screen name="my-profile" options={{ title: t('tab.myProfile'), href: showProfileTab(me) ? undefined : null }} />
      <Tabs.Screen name="account" options={{ title: t('tab.account'), tabBarBadge: unseen ? '' : undefined }} />
    </Tabs>
  )
}
