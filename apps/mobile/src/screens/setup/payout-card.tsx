import * as WebBrowser from 'expo-web-browser'
import { useCallback, useState } from 'react'
import { StyleSheet, Text } from 'react-native'

import { ApiError } from '@/api/client'
import { payoutStatus, startPayoutSetup } from '@/api/payments'
import { ErrorText } from '@/components/auth-ui'
import { Card, SmallButton } from '@/components/form-ui'
import { useLoad } from '@/hooks/use-load'
import { errorText, t } from '@/i18n'
import { payoutState } from '@/lib/payouts'

/** "Set up payouts": the status and the Stripe link. `useLoad` re-checks the status on focus and when the app returns to the front (no polling). */
export function PayoutCard() {
  const fetch = useCallback(() => payoutStatus(), [])
  const { data, retry } = useLoad(fetch)
  const [opened, setOpened] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const state = payoutState(data?.ready, opened)

  async function open() {
    setBusy(true)
    setProblem(null)
    try {
      const { url } = await startPayoutSetup()
      setOpened(true)
      await WebBrowser.openBrowserAsync(url)
      retry()
    } catch (e) {
      setProblem(errorText(e instanceof ApiError ? e.code : ''))
    }
    setBusy(false)
  }

  return (
    <Card done={state === 'ready'}>
      <Text style={styles.title} accessibilityRole="header">
        {t('payouts.setUp')}
      </Text>
      <Text style={styles.text}>{state === 'ready' ? t('payouts.ready') : state === 'waiting' ? t('payouts.waiting') : t('payouts.intro')}</Text>
      {state !== 'ready' && <Text style={styles.small}>{state === 'waiting' ? t('payouts.pending') : t('payouts.notStarted')}</Text>}
      {state !== 'ready' && <SmallButton label={t(state === 'waiting' ? 'payouts.continue' : 'payouts.setUp')} onPress={open} busy={busy} />}
      <ErrorText text={problem} />
    </Card>
  )
}

const styles = StyleSheet.create({
  title: { fontSize: 17, fontWeight: '700', color: '#14352E' },
  text: { fontSize: 16, color: '#14352E' },
  small: { fontSize: 14, color: '#5C7A72' },
})
