import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import Ionicons from '@expo/vector-icons/Ionicons'
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native'

import { ApiError, API_URL } from '@/api/client'
import { AddressFields, EMPTY_ADDRESS, toAddress } from '@/components/address-fields'
import { AuthScreen, Button, ErrorText, Field, LinkText } from '@/components/auth-ui'
import { SectionTitle, SwitchRow } from '@/components/form-ui'
import { DeniedNotice } from '@/screens/my-profile/denied-notice'
import { useSession } from '@/hooks/use-session'
import { errorText, getLang, t, useLang } from '@/i18n'
import { askPhotoSource } from '@/lib/ask-photo-source'
import { pickPhoto, uploadErrorCode } from '@/lib/pick'

/** The page staff publish on the website (slug agb or datenschutz), in the app's language. */
const openPage = (slug: 'agb' | 'datenschutz') => Linking.openURL(`${API_URL}/${slug}${getLang() === 'de' ? '' : '?lang=en'}`).catch(() => {})

export default function SignUpScreen() {
  useLang()
  const router = useRouter()
  const { offer } = useLocalSearchParams<{ offer?: string }>() // the welcome card "I offer my skills" presets the switch
  const { signUp } = useSession()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pictureUri, setPictureUri] = useState<string | null>(null)
  const [denied, setDenied] = useState(false)
  const [offerServices, setOfferServices] = useState(offer === '1')
  useEffect(() => setOfferServices(offer === '1'), [offer]) // a screen that stays mounted still follows the card tapped
  const [address, setAddress] = useState(EMPTY_ADDRESS)
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
    const addr = toAddress(address)
    if (addr === undefined) return setError(t('auth.addressIncomplete'))
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
    <AuthScreen title={t('auth.signUp')}>
      <Field label={t('auth.firstName')} value={firstName} onChangeText={setFirstName} autoComplete="given-name" />
      <Field label={t('auth.lastName')} value={lastName} onChangeText={setLastName} autoComplete="family-name" />
      <Field label={t('common.email')} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
      <Field label={`${t('common.password')} (${t('auth.passwordHint')})`} value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" />
      <View style={styles.picture}>
        {pictureUri && <Image source={{ uri: pictureUri }} accessibilityLabel={t('missing.photo')} style={styles.preview} />}
        <Button label={pictureUri ? t('myProfile.photoEdit') : t('missing.photo')} onPress={() => askPhotoSource(pick)} />
        <Text style={styles.why}>{t('auth.pictureWhy')}</Text>
        {denied && <DeniedNotice />}
      </View>
      <SwitchRow label={t('auth.offerServices')} value={offerServices} onChange={setOfferServices} />
      <SectionTitle text={t('auth.addressOptional')} />
      <AddressFields value={address} onChange={setAddress} />
      <Pressable style={styles.terms} onPress={() => setTerms(!terms)} accessibilityRole="checkbox" accessibilityState={{ checked: terms }} accessibilityLabel={t('auth.termsLabel')}>
        <Ionicons name={terms ? 'checkbox' : 'square-outline'} size={26} color="#0E8A6B" />
        <Text style={styles.termsText}>
          {t('auth.termsBefore')}
          <Text style={styles.link} onPress={() => openPage('agb')}>{t('auth.termsLink')}</Text>
          {t('auth.termsAnd')}
          <Text style={styles.link} onPress={() => openPage('datenschutz')}>{t('auth.privacyLink')}</Text>
          {t('auth.termsAfter')}
        </Text>
      </Pressable>
      <ErrorText text={error} />
      <Button label={t('auth.signUp')} onPress={submit} busy={busy} />
      <LinkText label={t('auth.haveAccount')} onPress={() => router.replace('/login')} />
    </AuthScreen>
  )
}

const styles = StyleSheet.create({
  picture: { gap: 8 },
  preview: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#BFE3D8' },
  why: { fontSize: 14, color: '#14352E' },
  terms: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, minHeight: 44 },
  termsText: { flex: 1, fontSize: 15, color: '#14352E' },
  link: { color: '#0B6B54', textDecorationLine: 'underline' },
})
