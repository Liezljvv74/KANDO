import type { IdScan, Me, Photo, PushSettings } from '@kando/contract'
import { useFocusEffect } from 'expo-router'
import { openBrowserAsync } from 'expo-web-browser'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, AppState, Pressable, StyleSheet, Text, View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { SafeAreaView } from 'react-native-safe-area-context'

import { ScreenBanner } from '@/components/screen-banner'

import { stopOffering } from '@/api/account'
import { API_URL, ApiError } from '@/api/client'
import { getPushSettings, setPushSettings } from '@/api/push'
import { AddressFields, EMPTY_ADDRESS, toAddress } from '@/components/address-fields'
import { DateTimeField } from '@/components/date-time-field'
import { Button, Field, KEYBOARD_GAP } from '@/components/auth-ui'
import { DoneBar } from '@/components/done-bar'
import { DONE_BAR_SPACE, SwitchRow } from '@/components/form-ui'
import { ErrorRetry } from '@/components/state-view'
import { LanguageSwitch } from '@/components/language-switch'
import { useDone } from '@/hooks/use-done'
import { loadMe, signOutGeneration, useMe } from '@/hooks/use-me'
import { useSession } from '@/hooks/use-session'
import { errorText, t, useLang } from '@/i18n'
import { accountEntryBody, shouldAutosave, unchangedSinceSave } from '@/lib/account-autosave'
import { confirmSignOut } from '@/lib/confirm-sign-out'
import { sendNow } from '@/lib/pending-runner'
import { putEntry, usePendingEntry, type PendingEntry } from '@/lib/pending-saves'
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
  const sending = useRef(false)
  const generation = useRef(signOutGeneration()) // a sign-out (or account deletion) changes it: nothing is sent for the old account
  const pendingNow = usePendingEntry('account')
  const stored = pendingNow && pendingNow.accountId === user?.id ? pendingNow : undefined // kept changes of this account fill the form first
  const storedRef = useRef(stored)
  storedRef.current = stored
  const pendingUsed = useRef(false)
  const [edited, setEdited] = useState(false) // a kept entry's error is about the old value: gone once the person edits
  const touch = () => (setError(null), setEdited(true))
  const lastSaved = useRef<string | null>(null) // the body last known to be on the server
  const [open, setOpen] = useState<boolean | null>(null) // the details form: null = by itself (open until the compulsory details are saved), else the person's choice

  const load = useCallback(async () => {
    try {
      const m = await loadMe()
      setLoadError(null)
      setMe(m)
      lastSaved.current = JSON.stringify({ firstName: (m.firstName ?? '').trim(), lastName: (m.lastName ?? '').trim(), address: m.address ? toAddress({ street: m.address.street ?? '', postcode: m.address.postcode, city: m.address.city ?? '' }, m.address.country) : null, birthDate: m.birthDate ?? null })
      setFirstName(m.firstName ?? '')
      setLastName(m.lastName ?? '')
      setBirthDate(fromIsoDay(m.birthDate))
      setAddress(m.address ? { street: m.address.street ?? '', postcode: m.address.postcode, city: m.address.city ?? '' } : EMPTY_ADDRESS)
      if (storedRef.current) applyStored(storedRef.current)
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.code : '') // the form stays hidden behind a retry
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])

  /** Once per visit: the kept (not yet saved or refused) values replace the server's in the form. */
  function applyStored(p: PendingEntry) {
    if (pendingUsed.current) return
    pendingUsed.current = true
    const b = p.body as ReturnType<typeof accountEntryBody>
    setFirstName(b.firstName)
    setLastName(b.lastName)
    setBirthDate(fromIsoDay(b.birthDate))
    setAddress(b.address ? { street: b.address.street ?? '', postcode: b.address.postcode, city: b.address.city ?? '' } : EMPTY_ADDRESS)
  }
  useEffect(() => {
    if (stored && me) applyStored(stored) // the store finished loading after the server answer
  }, [stored, me])

  /** The suggestions from an ID card scan fill the form (only what was read); nothing is saved until the person presses Done. */
  function applyScan(r: IdScan) {
    if (r.firstName) setFirstName(r.firstName)
    if (r.lastName) setLastName(r.lastName)
    if (r.birthDate) setBirthDate(fromIsoDay(r.birthDate))
    if (r.postcode || r.street || r.city) setAddress((a) => ({ street: r.street ?? a.street, postcode: r.postcode ?? a.postcode, city: r.city ?? a.city }))
    if (r.firstName || r.lastName || r.birthDate || r.postcode || r.street || r.city) touch()
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

  /** Why the details cannot be kept as they are (Done shows it), null when they can. */
  function invalid(): string | null {
    if (scanning) return t('account.busyWait') // the ID scan is still working: say so, not a vague error
    if (toAddress(address, me?.address?.country) === undefined) return t('auth.addressIncomplete')
    if (birthDate && toIsoDay(birthDate) >= toIsoDay(new Date())) return t('error.invalidBirthDate')
    return null
  }

  /** Keeps the details and sends them (Done and leaving never wait for it); true once the server took them. A failure is kept and shown by the banner and the stored entry. */
  async function save(): Promise<boolean> {
    const addr = toAddress(address, me?.address?.country)
    if (!firstName.trim() || !lastName.trim() || addr === undefined || invalid()) return false
    if (!user) return false // nothing can be kept or sent without an account
    const body = accountEntryBody({ firstName, lastName, address: addr, birthDate })
    pendingUsed.current = true
    setEdited(false)
    putEntry({ key: 'account', kind: 'account', accountId: user.id, body, route: '/account', field: 'details' })
    sending.current = true
    const ok = (await sendNow('account').finally(() => void (sending.current = false))) === 'ok'
    if (ok) lastSaved.current = JSON.stringify(body)
    return ok
  }

  // Leaving the screen or the app: valid, changed details are saved quietly with the same call as Done (never twice at once).
  const latest = useRef({ firstName, lastName, address, birthDate, loaded: false, signedIn: false, country: undefined as string | undefined, save })
  latest.current = { firstName, lastName, address, birthDate, loaded: !!me, signedIn: !!user, country: me?.address?.country, save }
  const autosave = () => {
    const v = latest.current
    if (!v.loaded || !v.signedIn || generation.current !== signOutGeneration() || !shouldAutosave(v)) return
    const body = JSON.stringify({ firstName: v.firstName.trim(), lastName: v.lastName.trim(), address: toAddress(v.address, v.country) ?? null, birthDate: v.birthDate ? toIsoDay(v.birthDate) : null })
    if (sending.current || unchangedSinceSave(body, lastSaved.current, !!storedRef.current)) return // a kept entry is replaced by the form's values even when they equal the server's
    void v.save()
  }
  // Account is a mounted tab: leaving it (focus lost) saves too, not only unmounting.
  useFocusEffect(useCallback(() => () => autosave(), []))
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s !== 'active' && autosave())
    return () => {
      sub.remove()
      autosave()
    }
  }, [])

  const isProvider = showProfileTab(shared ?? me)
  const done = useDone({
    isProvider,
    step: 'account',
    missing: () => accountMissing({ firstName, lastName, postcode: address.postcode, hasBirthDate: !!birthDate, isProvider }),
    invalid,
    flush: save,
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
      <KeyboardAwareScrollView contentContainerStyle={styles.scroll} bottomOffset={KEYBOARD_GAP + (me ? DONE_BAR_SPACE : 0)} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          {user && <Text style={styles.email}>{user.email}</Text>}
          <Button label={t('auth.logOut')} onPress={() => confirmSignOut(user?.id, signOut)} />
        </View>
        <PictureNudge />
        <View style={styles.card}>
          <Text style={styles.heading}>{t('account.detailsHeading')}</Text>
          {me && (
            <>
              <ProfilePhoto photo={me.photoUrl ? ({ url: me.photoUrl } as Photo) : null} name={`${firstName} ${lastName}`} onChanged={() => loadMe().then(setMe, () => {})} />
              <SwitchRow label={t('account.offerSwitch')} value={isProvider} onChange={changeOffer} disabled={busy} />
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: showDetails }} onPress={() => setOpen(!showDetails)}>
                <Text style={styles.fold}>{`${showDetails ? '▾' : '▸'} ${firstName} ${lastName}${address.postcode ? ` · ${address.postcode} ${address.city}` : ''}`.trim()}</Text>
              </Pressable>
              {showDetails && (
                <>
                  <IdScanButton onResult={applyScan} onBusy={setScanning} disabled={busy} />
                  <Field label={t('auth.firstName')} value={firstName} onChangeText={(v) => (setFirstName(v), touch())} autoComplete="given-name" editable={!busy && !scanning} />
                  <Field label={t('auth.lastName')} value={lastName} onChangeText={(v) => (setLastName(v), touch())} autoComplete="family-name" editable={!busy && !scanning} />
                  <DateTimeField label={t('auth.birthDate')} placeholder={t('auth.birthDatePlaceholder')} mode="date" value={birthDate} onChange={(d) => (setBirthDate(d), touch())} maximumDate={new Date()} initial={new Date()} disabled={busy || scanning} />
                  <AddressFields value={address} onChange={(a) => (setAddress(a), touch())} disabled={busy || scanning} />
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
      {me && <DoneBar onPress={done.onDone} disabled={busy} message={error ?? done.message ?? (stored?.state === 'refused' && !edited ? failureText(stored) : null)} />}
    </SafeAreaView>
  )
}

/** The error text of a failed (kept) account save. */
function failureText(e: PendingEntry | undefined): string {
  if (!e) return errorText('')
  return e.field === 'birthDate' ? t('error.invalidBirthDate') : errorText(e.state === 'refused' ? (e.reason ?? '') : '')
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
