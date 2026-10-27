import { useRouter } from 'expo-router'
import { useState } from 'react'

import { ApiError } from '@/api/client'
import { AuthScreen, Button, ErrorText, Field, LinkText } from '@/components/auth-ui'
import { useSession } from '@/hooks/use-session'
import { errorText, t, useLang } from '@/i18n'

export default function SignUpScreen() {
  useLang()
  const router = useRouter()
  const { signUp } = useSession()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!name.trim() || !email.trim() || password.length < 8) return setError(t('auth.fillAll'))
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError(t('auth.invalidEmail'))
    setBusy(true)
    setError(null)
    try {
      await signUp(name.trim(), email.trim(), password)
      router.replace({ pathname: '/verify-email', params: { email: email.trim() } })
    } catch (e) {
      setError(errorText(e instanceof ApiError ? e.code : ''))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthScreen title={t('auth.signUp')}>
      <Field label={t('common.name')} value={name} onChangeText={setName} autoComplete="name" />
      <Field label={t('common.email')} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
      <Field label={`${t('common.password')} (${t('auth.passwordHint')})`} value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" />
      <ErrorText text={error} />
      <Button label={t('auth.signUp')} onPress={submit} busy={busy} />
      <LinkText label={t('auth.haveAccount')} onPress={() => router.replace('/login')} />
    </AuthScreen>
  )
}
