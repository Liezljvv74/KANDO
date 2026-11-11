import type { IdScan, Me, Photo, PushSettings } from '@kando/contract'
import { openBrowserAsync } from 'expo-web-browser'
import { useCallback, useEffect, useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { SafeAreaView } from 'react-native-safe-area-context'

import { ScreenBanner } from '@/components/screen-banner'

import { stopOffering } from '@/api/account'
import { API_URL, ApiError, updateMe } from '@/api/client'
import { getPushSettings, setPushSettings } from '@/api/push'
import { AddressFields, EMPTY_ADDRESS, toAddress } from '@/components/address-fields'
import { DateTimeField } from '@/components/date-time-field'
import { Button, ErrorText, Field, KEYBOARD_GAP } from '@/components/auth-ui'
import { DoneBar } from '@/components/done-bar'
import { SwitchRow } from '@/components/form-ui'
import { ErrorRetry } from '@/components/state-view'
import { LanguageSwitch } from '@/components/language-switch'
import { useDone } from '@/hooks/use-done'
import { loadMe, useMe } from '@/hooks/use-me'
import { useSession } from '@/hooks/use-session'
import { errorText, t, useLang } from '@/i18n'
import { accountMissing } from '@/lib/required-fields'
import { showProfileTab } from '@/lib/profile-tab'
import { registerForPush } from '@/lib/push'
import { startOffering } from '@/lib/start-offering'
import { fromIsoDay, toIsoDay } from '@/lib/birth-date'
import { AccountDataSection } from '@/screens/account-data-section'
import { IdScanButton } from '@/screens/id-scan-button'
import { PictureNudge } from '@/screens/picture-nudge'
import { ProfilePhoto } from '@/screens/my-profile/photo-card'
import { color } from '@/theme'

export default function AccountScreen() {
  useLang()
  const { user, signOut } = useSession()
  const [me, setMe] = useState<Me | null>(null)
  const shared = useMe() // the shared copy holds the notifications and follows dismissals
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [birthDate, setBirthDate] = useState<Date | null>(null)
  const [scanning, setScanning] = useState(false) // an ID scan is running: the form is locked so its answer cannot overwrite an edit or a reload
  const [address, setAddress] = useState(EMPTY_ADDRESS)
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<boolean | null>(null) // the details form: null = by itself (open until the compulsory details are saved), else the person's choice

  const load = useCallback(async () => {
    try {
      const m = await loadMe()
      setLoadError(null)
      setMe(m)
      setFirstName(m.firstName ?? '')
      setLastName(m.lastName ?? '')
      setBirthDate(fromIsoDay(m.birthDate))
      setAddress(m.address ? { street: m.address.street ?? '', postcode: m.address.postcode, city: m.address.city ?? '' } : EMPTY_ADDRESS)
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.code : '') // the form stays hidden behind a retry
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])

  /** The suggestions from an ID card scan fill the form (only what was read); nothing is saved until the person presses Done. */
  function applyScan(r: IdScan) {
    if (r.firstName) setFirstName(r.firstName)
    if (r.lastName) setLastName(r.lastName)
    if (r.birthDate) setBirthDate(fromIsoDay(r.birthDate))
    if (r.postcode || r.street || r.city) setAddress((a) => ({ street: r.street ?? a.street, postcode: r.postcode ?? a.postcode, city: r.city ?? a.city }))
  }

  async function stop() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await stopOffering()
      await loadMe() // the My business tab goes away
    } catch (e) {
      setError(errorText(e instanceof ApiError ? e.code : ''))
    }
    setBusy(false)
  }

  async function offer() {
    if (busy) return
    setBusy(true)
    setError(null)
    setError(await startOffering())
    setBusy(false)
  }

  /** Saves the details; true on success, false on a validation or server error (the error text stays in the card). */
  async function save(): Promise<boolean> {
    if (busy || scanning) return false
    const addr = toAddress(address, me?.address?.country)
    if (!firstName.trim() || !lastName.trim()) return setError(t('auth.fillAll')), false
    if (addr === undefined) return setError(t('auth.addressIncomplete')), false
    if (birthDate && toIsoDay(birthDate) >= toIsoDay(new Date())) return setError(t('error.invalidBirthDate')), false
    setBusy(true)
    setError(null)
    let ok = false
    try {
      await updateMe({ firstName: firstName.trim(), lastName: lastName.trim(), address: addr, birthDate: birthDate ? toIsoDay(birthDate) : null })
      await load()
      setOpen(null) // saved: the card folds again once the compulsory details are in
      ok = true
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'Invalid input' && e.fields?.some((f) => f.startsWith('birthDate')) ? t('error.invalidBirthDate') : errorText(e instanceof ApiError ? e.code : ''))
    }
    setBusy(false)
    return ok
  }

  const isProvider = showProfileTab(shared ?? me)
  const done = useDone({
    isProvider,
    missing: () => accountMissing({ firstName, lastName, postcode: address.postcode, hasBirthDate: !!birthDate, isProvider }),
    commit: save,
  })
  // compulsory: the name and the postcode (a provider's date of birth too); with those saved the details card folds
  const complete = !!me && !!me.firstName?.trim() && !!me.lastName?.trim() && !!me.address?.postcode && (!isProvider || !!me.birthDate)
  const showDetails = open ?? !complete
  const changeOffer = (on: boolean) => {
    if (on) return void offer()
    Alert.alert(t('account.offerSwitch'), t('account.stopOfferingAsk'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('account.stopOfferingConfirm'), style: 'destructive', onPress: () => void stop() },
    ])
  }

  return (
    <SafeAreaView style={styles.root} edges={['left', 'right', 'bottom']}>
      <ScreenBanner title={t('tab.account')} />
      <KeyboardAwareScrollView contentContainerStyle={styles.scroll} bottomOffset={KEYBOARD_GAP} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          {user && <Text style={styles.email}>{user.email}</Text>}
          <Button label={t('auth.logOut')} onPress={signOut} />
        </View>
        <PictureNudge />
        <View style={styles.card}>
          <Text style={styles.heading}>{t('account.detailsHeading')}</Text>
          {me && (
            <>
              <ProfilePhoto photo={me.photoUrl ? ({ url: me.photoUrl } as Photo) : null} name={`${firstName} ${lastName}`} onChanged={() => loadMe().then(setMe, () => {})} />
              <SwitchRow label={t('account.offerSwitch')} value={isProvider} onChange={changeOffer} disabled={busy} />
              <ErrorText text={error} />
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: showDetails }} onPress={() => setOpen(!showDetails)}>
                <Text style={styles.fold}>{`${showDetails ? '▾' : '▸'} ${firstName} ${lastName}${address.postcode ? ` · ${address.postcode} ${address.city}` : ''}`.trim()}</Text>
              </Pressable>
              {showDetails && (
                <>
                  <IdScanButton onResult={applyScan} onBusy={setScanning} disabled={busy} />
                  <Field label={t('auth.firstName')} value={firstName} onChangeText={setFirstName} autoComplete="given-name" editable={!busy && !scanning} />
                  <Field label={t('auth.lastName')} value={lastName} onChangeText={setLastName} autoComplete="family-name" editable={!busy && !scanning} />
                  <DateTimeField label={t('auth.birthDate')} placeholder={t('auth.birthDatePlaceholder')} mode="date" value={birthDate} onChange={setBirthDate} maximumDate={new Date()} initial={new Date()} disabled={busy || scanning} />
                  <AddressFields value={address} onChange={setAddress} disabled={busy || scanning} />
                  <LanguageSwitch />
                </>
              )}
            </>
          )}
          {!me && loadError !== null && <ErrorRetry code={loadError} onRetry={load} />}
        </View>
        <View style={styles.card}>
          <Text style={styles.heading}>{t('account.exportHeading')}</Text>
          <AccountDataSection part="export" />
        </View>
        <PushSwitches />
        <AccountDataSection part="delete" />
        {/* Staff shortcut while testing; release builds never show it. The in-app browser's ✕ returns here (createTask false:
            on Android a separate browser task closed to the home screen, not back to the app). */}
        {__DEV__ && (
          <Text style={styles.link} accessibilityRole="link" onPress={() => openBrowserAsync(`${API_URL}/admin`, { createTask: false })}>
            {t('account.admin')}
          </Text>
        )}
      </KeyboardAwareScrollView>
      {me && <DoneBar onPress={done.onDone} busy={done.busy || busy} saved={done.saved} message={error ?? done.message} />}
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
  root: { flex: 1, backgroundColor: color.bg },
  scroll: { padding: 16, gap: 12 },
  card: { backgroundColor: color.surface, borderRadius: 16, padding: 16, gap: 12 },
  title: { fontSize: 22, fontWeight: '700', color: color.indigo },
  email: { fontSize: 16, color: color.ink },
  fold: { fontSize: 16, fontWeight: '600', color: color.indigo, minHeight: 44, textAlignVertical: 'center' },
  heading: { fontSize: 17, fontWeight: '700', color: color.ink },
  hint: { fontSize: 14, color: color.inkMuted },
  link: { paddingVertical: 12, textAlign: 'center', fontSize: 15, color: color.indigo, textDecorationLine: 'underline' },
})
