import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'

import { ApiError } from '@/api/client'
import { EMPTY_ADDRESS, toAddress } from '@/components/address-fields'
import { AuthScreen, Button, ErrorText, Field, LinkText } from '@/components/auth-ui'
import { TermsCheckbox } from '@/components/terms-checkbox'
import { DeniedNotice } from '@/screens/my-profile/denied-notice'
import { useSession } from '@/hooks/use-session'
import { errorText, t, useLang } from '@/i18n'
import { askPhotoSource } from '@/lib/ask-photo-source'
import { color, font } from '@/theme'
import { pickPhoto, uploadErrorCode } from '@/lib/pick'

export default function SignUpScreen() {
  useLang()
  const router = useRouter()
  const { offer } = useLocalSearchParams<{ offer?: string }>() // the welcome card "Register a service" presets the switch
  const { signUp } = useSession()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pictureUri, setPictureUri] = useState<string | null>(null)
  const [denied, setDenied] = useState(false)
  const [offerServices, setOfferServices] = useState(offer === '1')
  useEffect(() => setOfferServices(offer === '1'), [offer]) // a screen that stays mounted still follows the card tapped
  const [postcode, setPostcode] = useState('') // only the postcode is asked here; the street is asked when a job is booked at the person's address
  const [terms, setTerms] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function pick(source: 'camera' | 'library') {
    setDenied(false)
    setError(null)
    try {
      const file = await pickPhoto(source, true)
      if (file === 'denied') setDenied(true)
      else if (file) setPictureUri(file.uri)
    } catch (e) {
      setError(errorText(uploadErrorCode(e)))
    }
  }

  async function submit() {
    if (!firstName.trim() || !lastName.trim() || !email.trim() || password.length < 8) return setError(t('auth.fillAll'))
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError(t('auth.invalidEmail'))
    if (!terms) return setError(t('auth.termsRequired'))
    if (postcode.trim() && !/^[A-Za-z0-9][A-Za-z0-9 -]{1,8}[A-Za-z0-9]$/.test(postcode.trim())) return setError(t('auth.postcodeInvalid')) // a loose shape check (countries differ); the server checks the real format
    const addr = toAddress({ ...EMPTY_ADDRESS, postcode })
    setBusy(true)
    setError(null)
    try {
      // Saved after the code is confirmed (the server refuses an unconfirmed session); the password is never kept.
      await signUp(`${firstName.trim()} ${lastName.trim()}`, email.trim(), password, {
        email: email.trim().toLowerCase(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        offerServices,
        termsAccepted: true,
        pictureUri,
        address: addr,
      })
      router.replace({ pathname: '/verify-email', params: { email: email.trim() } })
    } catch (e) {
      setError(errorText(e instanceof ApiError ? e.code : ''))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthScreen title={t('auth.signUp')} legal>
      <Field label={t('auth.firstName')} value={firstName} onChangeText={setFirstName} autoComplete="given-name" />
      <Field label={t('auth.lastName')} value={lastName} onChangeText={setLastName} autoComplete="family-name" />
      <View style={styles.emailRow}>
        <View style={styles.emailCol}>
          <Field label={t('common.email')} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
        </View>
        <View style={styles.postcodeCol}>
          <Field label={t('address.postcode')} value={postcode} onChangeText={setPostcode} autoComplete="postal-code" autoCapitalize="characters" />
        </View>
      </View>
      <Field label={`${t('common.password')} (${t('auth.passwordHint')})`} value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" />
      <View style={styles.picture}>
        {pictureUri && <Image source={{ uri: pictureUri }} accessibilityLabel={t('missing.photo')} style={styles.preview} />}
        <Button label={pictureUri ? t('myProfile.photoEdit') : t('missing.photo')} onPress={() => askPhotoSource(pick)} />
        <Text style={styles.why}>{t('auth.pictureWhy')}</Text>
        {denied && <DeniedNotice />}
      </View>
      <Pressable
        onPress={() => setOfferServices(!offerServices)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: offerServices }}
        accessibilityLabel={t('auth.offerServices')}
        style={[styles.tile, offerServices && styles.tileOn]}>
        <View style={[styles.box, offerServices && styles.boxOn]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {offerServices && <Text style={styles.tick}>✓</Text>}
        </View>
        <Text style={[styles.tileText, offerServices && styles.tileTextOn]}>{t('auth.offerServices')}</Text>
      </Pressable>
      <TermsCheckbox checked={terms} onChange={setTerms} />
      <ErrorText text={error} />
      <Button label={t('auth.signUp')} onPress={submit} busy={busy} />
      <LinkText label={t('auth.haveAccount')} onPress={() => router.replace('/login')} />
    </AuthScreen>
  )
}

const styles = StyleSheet.create({
  emailRow: { flexDirection: 'row', gap: 12 },
  emailCol: { flex: 3 },
  postcodeCol: { flex: 2 },
  tile: { flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 84, padding: 18, borderRadius: 6, borderWidth: 2, borderStyle: 'dashed', borderColor: color.indigo, backgroundColor: color.bg },
  tileOn: { borderStyle: 'solid', backgroundColor: color.indigo },
  box: { width: 36, height: 36, borderRadius: 4, borderWidth: 3, borderColor: color.indigo, backgroundColor: color.surface, alignItems: 'center', justifyContent: 'center' },
  boxOn: { borderColor: color.teal, backgroundColor: color.teal },
  tick: { fontSize: 24, fontWeight: '900', color: color.ink },
  tileText: { flex: 1, fontFamily: font.heading, fontSize: 22, lineHeight: 26, color: color.ink },
  tileTextOn: { color: color.bg },
  picture: { gap: 8 },
  preview: { width: 72, height: 72, borderRadius: 36, backgroundColor: color.border },
  why: { fontSize: 14, color: color.ink },
})
