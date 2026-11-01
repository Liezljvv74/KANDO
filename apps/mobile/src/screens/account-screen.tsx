import type { Me, Photo, PushSettings } from '@kando/contract'
import { openBrowserAsync } from 'expo-web-browser'
import { useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { SafeAreaView } from 'react-native-safe-area-context'

import { API_URL, ApiError, updateMe } from '@/api/client'
import { getPushSettings, setPushSettings } from '@/api/push'
import { AddressFields, EMPTY_ADDRESS, toAddress } from '@/components/address-fields'
import { Button, ErrorText, Field, KEYBOARD_GAP, LinkText } from '@/components/auth-ui'
import { SwitchRow } from '@/components/form-ui'
import { ErrorRetry } from '@/components/state-view'
import { NotificationBanners } from '@/components/notification-banner'
import { LanguageSwitch } from '@/components/language-switch'
import { useFlash } from '@/hooks/use-flash'
import { loadMe, markNotificationsSeen, unseenOf, useMe } from '@/hooks/use-me'
import { useSession } from '@/hooks/use-session'
import { errorText, t, useLang } from '@/i18n'
import { go } from '@/lib/go'
import { registerForPush } from '@/lib/push'
import { startOffering } from '@/lib/start-offering'
import { AccountDataSection } from '@/screens/account-data-section'
import { InvoicesCard } from '@/screens/invoices/invoices-card'
import { QuotesCard } from '@/screens/quotes/quotes-card'
import { ProfilePhoto } from '@/screens/my-profile/photo-card'

export default function AccountScreen() {
  useLang()
  const { user, signOut } = useSession()
  const [me, setMe] = useState<Me | null>(null)
  const shared = useMe() // the shared copy holds the notifications and follows dismissals
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [address, setAddress] = useState(EMPTY_ADDRESS)
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, showSaved, hideSaved] = useFlash()

  const load = useCallback(async () => {
    try {
      const m = await loadMe()
      setLoadError(null)
      setMe(m)
      setFirstName(m.firstName ?? '')
      setLastName(m.lastName ?? '')
      setAddress(m.address ? { street: m.address.street ?? '', postcode: m.address.postcode, city: m.address.city ?? '' } : EMPTY_ADDRESS)
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.code : '') // the form stays hidden behind a retry
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])

  // The account page is where a customer reads their messages: clear the dot on every focus, and again if one arrives while it is open.
  // Marking updates the shared copy, so unseen turns false and the effect does not loop.
  const hasUnseen = unseenOf(shared?.notifications).length > 0
  useFocusEffect(
    useCallback(() => {
      if (hasUnseen) markNotificationsSeen().catch(() => {})
    }, [hasUnseen]),
  )

  async function offer() {
    if (busy) return
    setBusy(true)
    setError(null)
    setError(await startOffering())
    setBusy(false)
  }

  async function save() {
    const addr = toAddress(address, me?.address?.country)
    if (!firstName.trim() || !lastName.trim()) return setError(t('auth.fillAll'))
    if (addr === undefined) return setError(t('auth.addressIncomplete'))
    setBusy(true)
    setError(null)
    hideSaved()
    try {
      await updateMe({ firstName: firstName.trim(), lastName: lastName.trim(), address: addr })
      await load()
      showSaved()
    } catch (e) {
      setError(errorText(e instanceof ApiError ? e.code : ''))
    }
    setBusy(false)
  }

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAwareScrollView contentContainerStyle={styles.scroll} bottomOffset={KEYBOARD_GAP} keyboardShouldPersistTaps="handled">
        <NotificationBanners me={shared} />
        <View style={styles.card}>
          <Text style={styles.title}>{t('tab.account')}</Text>
          {user && <Text style={styles.email}>{user.email}</Text>}
          {me && (
            <>
              <ProfilePhoto photo={me.photoUrl ? ({ url: me.photoUrl } as Photo) : null} name={`${firstName} ${lastName}`} onChanged={() => loadMe().then(setMe, () => {})} />
              <Field label={t('auth.firstName')} value={firstName} onChangeText={(v) => (setFirstName(v), hideSaved())} autoComplete="given-name" editable={!busy} />
              <Field label={t('auth.lastName')} value={lastName} onChangeText={(v) => (setLastName(v), hideSaved())} autoComplete="family-name" editable={!busy} />
              <AddressFields value={address} onChange={(a) => (setAddress(a), hideSaved())} disabled={busy} />
              <Button label={t('common.save')} onPress={save} busy={busy} />
              {saved && <Text style={styles.saved}>{t('account.saved')}</Text>}
            </>
          )}
          {!me && loadError !== null && <ErrorRetry code={loadError} onRetry={load} />}
          <LinkText label={t('booking.myBookings')} onPress={() => go('/bookings')} />
          <LinkText label={t('chat.title')} onPress={() => go('/threads')} />
          <LinkText label={t('account.offerServices')} onPress={offer} />
          <ErrorText text={error} />
          <LanguageSwitch />
        </View>
        <PushSwitches />
        <QuotesCard />
        <InvoicesCard me={shared ?? me} />
        <Button label={t('auth.logOut')} onPress={signOut} />
        <AccountDataSection />
        {/* Staff shortcut while testing; release builds never show it. The in-app browser's ✕ returns here (createTask false:
            on Android a separate browser task closed to the home screen, not back to the app). */}
        {__DEV__ && (
          <Text style={styles.link} accessibilityRole="link" onPress={() => openBrowserAsync(`${API_URL}/admin`, { createTask: false })}>
            {t('account.admin')}
          </Text>
        )}
      </KeyboardAwareScrollView>
    </SafeAreaView>
  )
}

/** The two push switches; everything else about bookings and payments is always pushed. Hidden until loaded; a failed save flips back. */
function PushSwitches() {
  const [settings, setSettings] = useState<PushSettings | null>(null)
  useEffect(() => {
    getPushSettings().then(setSettings, () => {})
  }, [])
  if (!settings) return null
  const change = (key: keyof PushSettings) => (value: boolean) => {
    setSettings({ ...settings, [key]: value })
    if (value) registerForPush() // a phone that refused or failed earlier gets another try
    setPushSettings({ [key]: value }).then(setSettings, () => setSettings(settings))
  }
  return (
    <View style={styles.card}>
      <Text style={styles.heading}>{t('account.pushHeading')}</Text>
      <SwitchRow label={t('account.pushChat')} value={settings.chat} onChange={change('chat')} />
      <SwitchRow label={t('account.pushReminders')} value={settings.reminders} onChange={change('reminders')} />
      <Text style={styles.hint}>{t('account.pushHint')}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F2FBF8' },
  scroll: { padding: 16, gap: 12 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, gap: 12 },
  title: { fontSize: 22, fontWeight: '700', color: '#0E8A6B' },
  saved: { textAlign: 'center', fontSize: 15, fontWeight: '600', color: '#0E8A6B' },
  email: { fontSize: 16, color: '#14352E' },
  heading: { fontSize: 17, fontWeight: '700', color: '#14352E' },
  hint: { fontSize: 14, color: '#4B6B63' },
  link: { paddingVertical: 12, textAlign: 'center', fontSize: 15, color: '#0E8A6B', textDecorationLine: 'underline' },
})
