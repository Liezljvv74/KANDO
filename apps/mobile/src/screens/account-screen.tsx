import type { Me, Photo } from '@kando/contract'
import { router } from 'expo-router'
import { openBrowserAsync } from 'expo-web-browser'
import { useCallback, useEffect, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { API_URL, ApiError, updateMe } from '@/api/client'
import { AddressFields, EMPTY_ADDRESS, toAddress } from '@/components/address-fields'
import { Button, ErrorText, Field, LinkText } from '@/components/auth-ui'
import { LanguageSwitch } from '@/components/language-switch'
import { useFlash } from '@/hooks/use-flash'
import { loadMe } from '@/hooks/use-me'
import { useSession } from '@/hooks/use-session'
import { errorText, t, useLang } from '@/i18n'
import { ProfilePhoto } from '@/screens/my-profile/photo-card'

export default function AccountScreen() {
  useLang()
  const { user, signOut } = useSession()
  const [me, setMe] = useState<Me | null>(null)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [address, setAddress] = useState(EMPTY_ADDRESS)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, showSaved, hideSaved] = useFlash()

  const load = useCallback(async () => {
    try {
      const m = await loadMe()
      setMe(m)
      setFirstName(m.firstName ?? '')
      setLastName(m.lastName ?? '')
      setAddress(m.address ? { street: m.address.street ?? '', postcode: m.address.postcode, city: m.address.city ?? '' } : EMPTY_ADDRESS)
    } catch {
      // The form stays hidden; the next visit loads again.
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])

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
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <View style={styles.card}>
          <Text style={styles.title}>{t('tab.account')}</Text>
          {user && <Text style={styles.email}>{user.email}</Text>}
          {me && (
            <>
              <ProfilePhoto photo={me.photoUrl ? ({ url: me.photoUrl } as Photo) : null} name={`${firstName} ${lastName}`} onChanged={() => loadMe().then(setMe, () => {})} />
              <Field label={t('auth.firstName')} value={firstName} onChangeText={(v) => (setFirstName(v), hideSaved())} autoComplete="given-name" />
              <Field label={t('auth.lastName')} value={lastName} onChangeText={(v) => (setLastName(v), hideSaved())} autoComplete="family-name" />
              <AddressFields value={address} onChange={(a) => (setAddress(a), hideSaved())} />
              <ErrorText text={error} />
              <Button label={t('common.save')} onPress={save} busy={busy} />
              {saved && <Text style={styles.saved}>{t('account.saved')}</Text>}
            </>
          )}
          <LinkText label={t('account.offerServices')} onPress={() => router.navigate('/my-profile')} />
          <LanguageSwitch />
        </View>
        <Button label={t('auth.logOut')} onPress={signOut} />
        {/* Staff shortcut while testing; release builds never show it. The in-app browser's ✕ returns here (createTask false:
            on Android a separate browser task closed to the home screen, not back to the app). */}
        {__DEV__ && (
          <Text style={styles.link} accessibilityRole="link" onPress={() => openBrowserAsync(`${API_URL}/admin`, { createTask: false })}>
            {t('account.admin')}
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F2FBF8' },
  scroll: { padding: 16, gap: 12 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, gap: 12 },
  title: { fontSize: 22, fontWeight: '700', color: '#0E8A6B' },
  saved: { textAlign: 'center', fontSize: 15, fontWeight: '600', color: '#0E8A6B' },
  email: { fontSize: 16, color: '#14352E' },
  link: { paddingVertical: 12, textAlign: 'center', fontSize: 15, color: '#0E8A6B', textDecorationLine: 'underline' },
})
