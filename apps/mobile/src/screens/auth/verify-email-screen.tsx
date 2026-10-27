import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'

import { sendVerificationCode } from '@/api/auth'
import { ApiError } from '@/api/client'
import { AuthScreen, Button, ErrorText, Field, Info, LinkText } from '@/components/auth-ui'
import { useSession } from '@/hooks/use-session'
import { errorText, t, useLang } from '@/i18n'

/** "Enter the code we emailed you": a correct code confirms the address and signs in (the root layout then shows the tabs). */
export default function VerifyEmailScreen() {
  useLang()
  const { email = '' } = useLocalSearchParams<{ email?: string }>()
  const { verify } = useSession()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      // Where to land is decided here, once (the global router: the guard has already swapped this screen out): the setup page for people who ticked "offer services", else Home.
      const offerServices = await verify(email, code.trim())
      router.replace(offerServices ? '/my-profile?welcome=1' : '/')
    } catch (e) {
      setError(errorText(e instanceof ApiError ? e.code : ''))
      setBusy(false)
    }
  }

  async function resend() {
    setError(null)
    try {
      await sendVerificationCode(email)
    } catch (e) {
      setError(errorText(e instanceof ApiError ? e.code : ''))
    }
  }

  return (
    <AuthScreen title={t('auth.checkEmailTitle')}>
      <Info text={t('auth.codeSent', { email })} />
      <Field label={t('auth.enterCode')} value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={6} />
      <ErrorText text={error} />
      <Button label={t('auth.verifySubmit')} onPress={submit} busy={busy} />
      <LinkText label={t('auth.resendCode')} onPress={resend} />
      <LinkText label={t('auth.back')} onPress={() => router.replace('/login')} />
    </AuthScreen>
  )
}
