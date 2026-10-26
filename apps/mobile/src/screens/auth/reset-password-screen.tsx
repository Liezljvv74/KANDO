import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'

import { requestPasswordReset, resetPassword } from '@/api/auth'
import { ApiError } from '@/api/client'
import { AuthScreen, Button, ErrorText, Field, Info, LinkText } from '@/components/auth-ui'
import { errorText, t, useLang } from '@/i18n'

/** The emailed code plus the new password (twice); afterwards the user logs in with it. */
export default function ResetPasswordScreen() {
  useLang()
  const router = useRouter()
  const { email = '' } = useLocalSearchParams<{ email?: string }>()
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  async function submit() {
    if (!code.trim() || password.length < 8) return setError(t('auth.fillAll'))
    if (password !== repeat) return setError(t('auth.passwordMismatch'))
    setBusy(true)
    setError(null)
    try {
      await resetPassword(email, code.trim(), password)
      setDone(true)
    } catch (e) {
      setError(errorText(e instanceof ApiError ? e.code : ''))
    } finally {
      setBusy(false)
    }
  }

  async function resend() {
    setError(null)
    try {
      await requestPasswordReset(email)
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) setError(errorText(e.code))
    }
  }

  return (
    <AuthScreen title={t('auth.forgotTitle')}>
      {done ? (
        <Info text={t('auth.passwordChanged')} />
      ) : (
        <>
          <Info text={t('auth.forgotSent')} />
          <Field label={t('auth.enterCode')} value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={6} />
          <Field label={`${t('auth.newPassword')} (${t('auth.passwordHint')})`} value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" />
          <Field label={t('auth.repeatPassword')} value={repeat} onChangeText={setRepeat} secureTextEntry autoComplete="new-password" />
          <ErrorText text={error} />
          <Button label={t('auth.resetSubmit')} onPress={submit} busy={busy} />
          <LinkText label={t('auth.resendCode')} onPress={resend} />
        </>
      )}
      <LinkText label={t('auth.back')} onPress={() => router.replace('/login')} />
    </AuthScreen>
  )
}
