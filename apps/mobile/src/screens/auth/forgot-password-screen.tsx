import { useRouter } from 'expo-router'
import { useState } from 'react'

import { requestPasswordReset } from '@/api/auth'
import { ApiError } from '@/api/client'
import { AuthScreen, Button, ErrorText, Field, Info, LinkText } from '@/components/auth-ui'
import { errorText, t, useLang } from '@/i18n'

export default function ForgotPasswordScreen() {
  useLang()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError(t('auth.invalidEmail'))
    setBusy(true)
    setError(null)
    try {
      await requestPasswordReset(email.trim())
    } catch (e) {
      // Only a lost connection is shown; every server answer leads to the same code screen.
      if (e instanceof ApiError && e.status === 0) {
        setBusy(false)
        return setError(errorText(e.code))
      }
    }
    setBusy(false)
    router.push({ pathname: '/reset-password', params: { email: email.trim() } })
  }

  return (
    <AuthScreen title={t('auth.forgotTitle')}>
      <Info text={t('auth.forgotBody')} />
      <Field label={t('common.email')} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
      <ErrorText text={error} />
      <Button label={t('auth.forgotSend')} onPress={submit} busy={busy} />
      <LinkText label={t('auth.back')} onPress={() => router.replace('/login')} />
    </AuthScreen>
  )
}
