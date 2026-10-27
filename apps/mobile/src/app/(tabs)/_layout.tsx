import { Tabs } from 'expo-router'

import { t, useLang } from '@/i18n'

export default function TabsLayout() {
  useLang()
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: '#0E8A6B', tabBarInactiveTintColor: '#5C7A72' }}>
      <Tabs.Screen name="index" options={{ title: t('tab.home') }} />
      <Tabs.Screen name="search" options={{ title: t('tab.search') }} />
      <Tabs.Screen name="my-profile" options={{ title: t('tab.myProfile') }} />
      <Tabs.Screen name="account" options={{ title: t('tab.account') }} />
    </Tabs>
  )
}
