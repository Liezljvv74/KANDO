import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'

import { sendVerificationCode } from '@/api/auth'
import { ApiError } from '@/api/client'
import { AuthScreen, Button, ErrorText, Field, Info, LinkText } from '@/components/auth-ui'
import { useSession } from '@/hooks/use-session'
import { errorText, t, useLang } from '@/i18n'
import { afterVerifyTarget, consumeAfterLogin, setAfterLogin } from '@/lib/after-login'
import { setPending } from '@/lib/pending-navigation'
import { startOffering } from '@/lib/start-offering'

/** "Enter the code we emailed you": a correct code confirms the address and signs in (the root layout then shows the tabs). */
export default function VerifyEmailScreen() {
  useLang()
  const { email = '' } = useLocalSearchParams<{ email?: string }>()
  const { verify } = useSession()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [resending, setResending] = useState(false)

  async function submit() {
    setBusy(true)
    setError(null)
    // Taken before the person counts as signed in: Home reads the same value the moment they do, and only one of the two may get it.
    const stored = await consumeAfterLogin()
    try {
      // Where to land is decided here, once and handed to the tabs layout (a navigation made in this screen was lost when the guard swapped it out): the setup page for people who ticked "offer services", else the page they came from (a provider) or Search.
      // The setup (the draft profile) runs inside verify, before the person counts as signed in, so Home is never shown in between and the tabs layout opens the setup page at once. If it fails: Home; the setup page creates the draft itself.
      const offerServices = await verify(email, code.trim(), async () => void (await startOffering(true)))
      const target = afterVerifyTarget(offerServices, stored)
      if (target) setPending({ path: target }) // the tabs layout opens it once the sign-in screens are gone (a navigation made here was lost)
    } catch (e) {
      if (stored) void setAfterLogin(stored) // a wrong code: the target is kept for the next try
      setError(errorText(e instanceof ApiError ? e.code : ''))
      setBusy(false)
    }
  }

  async function resend() {
    setError(null)
    setResending(true)
    try {
      await sendVerificationCode(email)
    } catch (e) {
      setError(errorText(e instanceof ApiError ? e.code : ''))
    } finally {
      setResending(false)
    }
  }

  return (
    <AuthScreen title={t('auth.checkEmailTitle')}>
      <Info text={t('auth.codeSent', { email })} />
      <Field label={t('auth.enterCode')} value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={6} />
      <ErrorText text={error} />
      <Button label={t('auth.verifySubmit')} onPress={submit} busy={busy} />
      <LinkText label={t('auth.resendCode')} onPress={resend} disabled={resending} />
      <LinkText label={t('auth.back')} onPress={() => router.replace('/login')} />
    </AuthScreen>
  )
}
