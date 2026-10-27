import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Image, StyleSheet, Text, View } from 'react-native'

import { ApiError } from '@/api/client'
import { AddressFields, EMPTY_ADDRESS, toAddress } from '@/components/address-fields'
import { AuthScreen, Button, ErrorText, Field, LinkText } from '@/components/auth-ui'
import { SectionTitle, SwitchRow } from '@/components/form-ui'
import { DeniedNotice } from '@/screens/my-profile/denied-notice'
import { useSession } from '@/hooks/use-session'
import { errorText, t, useLang } from '@/i18n'
import { askPhotoSource } from '@/lib/ask-photo-source'
import { savePending } from '@/lib/pending-signup'
import { pickPhoto, uploadErrorCode } from '@/lib/pick'

export default function SignUpScreen() {
  useLang()
  const router = useRouter()
  const { signUp } = useSession()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pictureUri, setPictureUri] = useState<string | null>(null)
  const [denied, setDenied] = useState(false)
  const [offerServices, setOfferServices] = useState(false)
  const [address, setAddress] = useState(EMPTY_ADDRESS)
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
    const addr = toAddress(address)
    if (addr === undefined) return setError(t('auth.addressIncomplete'))
    setBusy(true)
    setError(null)
    try {
      // Saved after the code is confirmed (the server refuses an unconfirmed session); the password is never kept.
      await savePending({ firstName: firstName.trim(), lastName: lastName.trim(), offerServices, pictureUri, address: addr })
      await signUp(`${firstName.trim()} ${lastName.trim()}`, email.trim(), password)
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
})
