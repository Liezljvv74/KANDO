import Ionicons from '@expo/vector-icons/Ionicons'
import { router, Tabs, useFocusEffect } from 'expo-router'
import { BottomTabBar, type BottomTabBarProps } from 'expo-router/js-tabs'
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { AppState, type ColorValue } from 'react-native'

import { jobCounts } from '@/api/jobs'
import { loadMe, unseenOf, useMe } from '@/hooks/use-me'
import { getSession, useSession } from '@/hooks/use-session'
import { t, useLang } from '@/i18n'
import { categoryOf } from '@/lib/job-notices'
import { tabBadge } from '@/lib/jobs'
import { consumePending, readyToNavigate, urlOf, usePending } from '@/lib/pending-navigation'
import { showProfileTab } from '@/lib/profile-tab'
import { color } from '@/theme'

/** Screens kept inside the tab bar (the bar stays on every signed-in screen): tabs without a button, each lighting the tab it belongs to. */
const HIDDEN = ['bookings', 'invoices', 'learn', 'provider/[slug]', 'quotes/index', 'threads'] as const
const LIT: Record<string, string> = { bookings: 'jobs', invoices: 'jobs', threads: 'jobs', 'quotes/index': 'jobs', 'provider/[slug]': 'search', learn: 'index' }
const bar = (props: BottomTabBarProps) => {
  // the screens without a button are left out of what the bar draws (else they take empty slots and squeeze the real tabs)
  const here = props.state.routes[props.state.index]?.name ?? ''
  const lit = LIT[here] ?? here
  const routes = props.state.routes.filter((r) => !props.descriptors[r.key]?.options.tabBarButton) // a screen with no button is not drawn
  const index = Math.max(0, routes.findIndex((r) => r.name === lit))
  const descriptors = Object.fromEntries(routes.map((r) => [r.key, props.descriptors[r.key]!]))
  // On a hidden screen the bar lights the tab it belongs to, which the bar then takes for "already open": a tap on it must still go there.
  const emitter = {
    ...props.emitter,
    emit: ((event: { type: string; target?: string }) => {
      const result = (props.emitter.emit as (e: unknown) => unknown)(event)
      if (event.type === 'tabPress' && LIT[here] && event.target === routes[index]?.key) props.navigateToTab(event.target)
      return result
    }) as typeof props.emitter.emit,
  }
  return <BottomTabBar {...props} emitter={emitter} state={{ ...props.state, routes, index }} descriptors={descriptors} />
}

const icon = (name: React.ComponentProps<typeof Ionicons>['name']) => ({ color, size }: { color: ColorValue; size: number }) => <Ionicons name={name} size={size} color={color as string} />

export default function TabsLayout() {
  useLang()
  const me = useMe()
  const { user } = useSession() // signed out: every tab shows (the private ones ask for a login)
  // "Offer services": go to the profile page only once this layout has rendered with the tab visible and the person is signed in.
  const pending = usePending()
  useEffect(() => {
    if (!readyToNavigate(pending, me, !!user)) return // the target stays until the tab is visible
    // One tick later: this layout is already mounted while signed out, so this effect runs in the very commit that removes the sign-in screens, and a navigation made inside it was overridden (the person ended on Home).
    const timer = setTimeout(() => {
      const p = consumePending()
      if (p) router.navigate(urlOf(p))
    }, 0)
    return () => clearTimeout(timer)
  }, [me, pending, user])
  // A notification created while the app was in the background shows its dot as soon as the user returns.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && getSession().user && loadMe().catch(() => {})) // signed out there is no account to ask for
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
    <Tabs backBehavior="history" tabBar={bar} screenOptions={{ headerShown: false, tabBarHideOnKeyboard: true, tabBarActiveTintColor: color.indigo, tabBarInactiveTintColor: color.inkMuted, tabBarStyle: { backgroundColor: color.surface, borderTopColor: color.divider }, tabBarLabelStyle: { fontWeight: '700' } }}>
      <Tabs.Screen name="index" options={{ tabBarIcon: icon('home-outline'), title: t('tab.home') }} />
      <Tabs.Screen name="search" options={{ tabBarIcon: icon('search-outline'), title: t('tab.search') }} />
      <Tabs.Screen name="jobs" options={{ title: t('tab.jobs'), tabBarBadge: badge > 0 ? badge : undefined, tabBarIcon: icon('clipboard-outline') }} />
      <Tabs.Screen name="my-profile" options={{ tabBarIcon: icon('briefcase-outline'), title: t('tab.myProfile'), tabBarBadge: businessDot ? '' : undefined, ...(!user || showProfileTab(me) ? {} : { tabBarButton: () => null }) }} /> // not `href: null`: that redirects away, also while the profile is still loading on a reload
      <Tabs.Screen name="account" options={{ tabBarIcon: icon('person-outline'), title: t('tab.account') }} />
      {HIDDEN.map((name) => (
        <Tabs.Screen key={name} name={name} options={{ tabBarButton: () => null }} /> // no button, but still reachable (`href: null` hides AND redirects away in this Expo Router)
      ))}
    </Tabs>
  )
}
