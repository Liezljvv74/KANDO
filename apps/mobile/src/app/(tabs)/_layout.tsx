import Ionicons from '@expo/vector-icons/Ionicons'
import { router, Tabs } from 'expo-router'
import { useEffect } from 'react'
import { AppState, type ColorValue } from 'react-native'

import { loadMe, unseenOf, useMe } from '@/hooks/use-me'
import { t, useLang } from '@/i18n'
import { categoryOf, unseenCounts } from '@/lib/correspondence'
import { consumePending, readyToNavigate, urlOf, usePending } from '@/lib/pending-navigation'
import { showProfileTab } from '@/lib/profile-tab'

const icon = (name: React.ComponentProps<typeof Ionicons>['name']) => ({ color, size }: { color: ColorValue; size: number }) => <Ionicons name={name} size={size} color={color as string} />

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
  // The number of requests, bookings, quotes and messages the person has not looked at yet (opening each list marks its notices seen).
  const unseen = unseenCounts(me?.notifications).total
  // Provider notices (payouts, documents, invoices ...) show as a dot on My business, where opening the page marks them seen.
  const businessDot = unseenOf(me?.notifications).some((n) => !n.dismissedAt && !categoryOf(n))
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: '#34328A', tabBarInactiveTintColor: '#4F4E7D', tabBarStyle: { backgroundColor: '#fff', borderTopColor: '#CFE6DC' }, tabBarLabelStyle: { fontWeight: '700' } }}>
      <Tabs.Screen name="index" options={{ tabBarIcon: icon('home-outline'), title: t('tab.home') }} />
      <Tabs.Screen name="search" options={{ tabBarIcon: icon('search-outline'), title: t('tab.search') }} />
      <Tabs.Screen
        name="correspondence"
        options={{ title: t('tab.correspondence'), tabBarBadge: unseen > 0 ? unseen : undefined, tabBarIcon: icon('mail-outline') }}
      />
      <Tabs.Screen name="my-profile" options={{ tabBarIcon: icon('briefcase-outline'), title: t('tab.myProfile'), tabBarBadge: businessDot ? '' : undefined, href: showProfileTab(me) ? undefined : null }} />
      <Tabs.Screen name="account" options={{ tabBarIcon: icon('person-outline'), title: t('tab.account') }} />
    </Tabs>
  )
}
