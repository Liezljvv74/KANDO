import { useRouter } from 'expo-router'
import { useState } from 'react'

import { ApiError } from '@/api/client'
import { AuthScreen, Button, ErrorText, Field, LinkText } from '@/components/auth-ui'
import { useSession } from '@/hooks/use-session'
import { errorText, t, useLang } from '@/i18n'

export default function LoginScreen() {
  useLang()
  const router = useRouter()
  const { signIn } = useSession()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      // 'signed-in': the root layout redirects once the user is set. 'verify': a code is on its way.
      if ((await signIn(email.trim(), password)) === 'verify') {
        setBusy(false)
        router.push({ pathname: '/verify-email', params: { email: email.trim() } })
      }
    } catch (e) {
      setError(errorText(e instanceof ApiError ? e.code : ''))
      setBusy(false)
    }
  }

  return (
    <AuthScreen title={t('auth.logIn')}>
      <Field label={t('common.email')} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
      <Field label={t('common.password')} value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" />
      <ErrorText text={error} />
      <Button label={t('auth.logIn')} onPress={submit} busy={busy} />
      <LinkText label={t('auth.forgot')} onPress={() => router.push('/forgot-password')} />
      <LinkText label={t('auth.noAccount')} onPress={() => router.push('/sign-up')} />
    </AuthScreen>
  )
}
