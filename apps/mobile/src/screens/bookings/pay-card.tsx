import * as WebBrowser from 'expo-web-browser'
import { useEffect, useRef, useState } from 'react'
import { AppState, Platform, StyleSheet, Text } from 'react-native'

import type { Booking } from '@kando/contract'

import { payBooking } from '@/api/payments'
import { ErrorText } from '@/components/auth-ui'
import { Card, SmallButton } from '@/components/form-ui'
import { errorText, t } from '@/i18n'
import type { Viewer } from '@/lib/booking-status'
import { useMe } from '@/hooks/use-me'
import { paymentsOff, paymentsProblem } from '@/lib/payments-off'
import { isHttps } from '@/lib/safe-url'

/**
 * The pay area of a booking. "Pay now" opens the Stripe page in the in-app browser; the server's state (jobState) decides what
 * shows: Pay now, or Pay again when the checkout did not go through (the card text is the state card above). iOS resolves
 * `openBrowserAsync` when the browser closes; Android right when it opens, so there the return is the app coming back to the
 * front: either way the booking reloads.
 */
export function PayPanel({ booking, viewer, onRefresh }: { booking: Booking; viewer: Viewer; onRefresh: () => void }) {
  const me = useMe()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const waiting = useRef(false)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active' || !waiting.current) return
      waiting.current = false
      onRefresh()
    })
    return () => sub.remove()
  }, [onRefresh])

  async function pay() {
    setBusy(true)
    setProblem(null)
    try {
      const { url } = await payBooking(booking.id)
      if (!isHttps(url)) throw new Error('bad link')
      waiting.current = true
      await WebBrowser.openBrowserAsync(url)
      if (Platform.OS === 'ios') waiting.current = false
      onRefresh()
    } catch (e) {
      setProblem(paymentsProblem(e))
    }
    setBusy(false)
  }

  const key = booking.jobState?.key
  if (viewer !== 'customer' || (key !== 'payment_due' && key !== 'checkout_not_completed')) return null
  return (
    <Card>
      {paymentsOff(me) ? <Text style={styles.text}>{errorText('PAYMENTS_OFF')}</Text> : <SmallButton label={t(key === 'checkout_not_completed' ? 'booking.payAgain' : 'booking.payNow')} onPress={pay} busy={busy} />}
      <ErrorText text={problem} />
    </Card>
  )
}

const styles = StyleSheet.create({
  text: { fontSize: 16, color: '#1D1C4A' },
})
