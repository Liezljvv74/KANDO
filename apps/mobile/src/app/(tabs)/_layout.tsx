import Ionicons from '@expo/vector-icons/Ionicons'
import { router, Tabs, useFocusEffect } from 'expo-router'
import { BottomTabBar, type BottomTabBarProps } from 'expo-router/js-tabs'
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { AppState, type ColorValue } from 'react-native'

import { jobCounts } from '@/api/jobs'
import { loadMe, unseenOf, useMe } from '@/hooks/use-me'
import { t, useLang } from '@/i18n'
import { categoryOf } from '@/lib/correspondence'
import { tabBadge } from '@/lib/jobs'
import { consumePending, readyToNavigate, urlOf, usePending } from '@/lib/pending-navigation'
import { showProfileTab } from '@/lib/profile-tab'

/** Screens kept inside the tab bar (the bar stays on every signed-in screen): hidden tabs, each lighting the tab it belongs to. */
const HIDDEN = ['bookings', 'invoices', 'learn', 'provider/[slug]', 'quotes/index', 'threads'] as const
const LIT: Record<string, string> = { bookings: 'jobs', invoices: 'jobs', threads: 'jobs', 'quotes/index': 'jobs', 'provider/[slug]': 'search', learn: 'index' }
const bar = (props: BottomTabBarProps) => {
  const lit = LIT[props.state.routes[props.state.index]?.name ?? '']
  const index = lit ? props.state.routes.findIndex((r) => r.name === lit) : -1
  return <BottomTabBar {...props} state={index < 0 ? props.state : { ...props.state, index }} />
}

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
  // The Jobs badge: the customer and the provider counter added (jobs that need me or have unread messages, each once per side), from
  // the shared counts the Jobs screen also writes. Read again when the tabs come back into view (after acting on a job page or
  // reading a chat), when the app returns to the front, and when a new notice arrives; the Jobs screen's own load joins the same call.
  const badge = tabBadge(useSyncExternalStore(jobCounts.subscribe, jobCounts.get))
  const signedIn = !!me
  const provider = !!me?.isProvider
  const notices = me?.notifications[0]?.id // the newest notice (the list is newest first and capped at 20: its length stops changing)
  useFocusEffect(
    useCallback(() => {
      if (!signedIn) return jobCounts.clear()
      const refresh = () => jobCounts.load(provider ? ['customer', 'provider'] : ['customer']).catch(() => {})
      refresh()
      const sub = AppState.addEventListener('change', (s) => s === 'active' && refresh())
      return () => sub.remove()
    }, [signedIn, provider, notices]),
  )
  // Provider notices (payouts, documents, invoices ...) show as a dot on My business, where opening the page marks them seen.
  const businessDot = unseenOf(me?.notifications).some((n) => !n.dismissedAt && !categoryOf(n))
  return (
    <Tabs backBehavior="history" tabBar={bar} screenOptions={{ headerShown: false, tabBarHideOnKeyboard: true, tabBarActiveTintColor: '#34328A', tabBarInactiveTintColor: '#4F4E7D', tabBarStyle: { backgroundColor: '#fff', borderTopColor: '#CFE6DC' }, tabBarLabelStyle: { fontWeight: '700' } }}>
      <Tabs.Screen name="index" options={{ tabBarIcon: icon('home-outline'), title: t('tab.home') }} />
      <Tabs.Screen name="search" options={{ tabBarIcon: icon('search-outline'), title: t('tab.search') }} />
      <Tabs.Screen name="jobs" options={{ title: t('tab.jobs'), tabBarBadge: badge > 0 ? badge : undefined, tabBarIcon: icon('clipboard-outline') }} />
      <Tabs.Screen name="my-profile" options={{ tabBarIcon: icon('briefcase-outline'), title: t('tab.myProfile'), tabBarBadge: businessDot ? '' : undefined, href: showProfileTab(me) ? undefined : null }} />
      <Tabs.Screen name="account" options={{ tabBarIcon: icon('person-outline'), title: t('tab.account') }} />
      {HIDDEN.map((name) => (
        <Tabs.Screen key={name} name={name} options={{ href: null }} />
      ))}
    </Tabs>
  )
}
