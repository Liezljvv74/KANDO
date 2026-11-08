import * as WebBrowser from 'expo-web-browser'
import { useEffect, useRef, useState } from 'react'
import { AppState, Modal, Platform, StyleSheet, Text, View } from 'react-native'

import type { Booking } from '@kando/contract'

import { payBooking } from '@/api/payments'
import { Button, ErrorText, LinkText } from '@/components/auth-ui'
import { Card, SmallButton } from '@/components/form-ui'
import { errorText, t } from '@/i18n'
import { formatPrice } from '@/lib/format'
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
/** The one pay route (Stripe page in the in-app browser, then a reload): the Pay now button and the pop-up after accepting a quote both use it. */
function usePay(booking: Booking, onRefresh: () => void) {
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
  return { busy, problem, pay }
}

export function PayPanel({ booking, viewer, onRefresh }: { booking: Booking; viewer: Viewer; onRefresh: () => void }) {
  const me = useMe()
  const { busy, problem, pay } = usePay(booking, onRefresh)

  const key = booking.jobState?.key
  if (viewer !== 'customer' || (key !== 'payment_due' && key !== 'checkout_not_completed')) return null
  return (
    <Card>
      {paymentsOff(me) ? <Text style={styles.text}>{errorText('PAYMENTS_OFF')}</Text> : <SmallButton label={t(key === 'checkout_not_completed' ? 'booking.payAgain' : 'booking.payNow')} onPress={pay} busy={busy} />}
      <ErrorText text={problem} />
    </Card>
  )
}

/** Shown right after the customer accepts a quote whose booking waits for payment; "Not now" leaves it (Pay now stays on the job page). */
export function PayPrompt({ booking, onClose, onRefresh }: { booking: Booking; onClose: () => void; onRefresh: () => void }) {
  const me = useMe()
  const { busy, problem, pay } = usePay(booking, () => {
    onClose()
    onRefresh()
  })
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} accessibilityViewIsModal>
      <View style={styles.backdrop}>
        <View style={styles.box}>
          <Text style={styles.text}>{t('booking.payPromptNote')}</Text>
          {paymentsOff(me) ? <Text style={styles.text}>{errorText('PAYMENTS_OFF')}</Text> : <Button label={t('booking.payAmount', { amount: formatPrice({ priceType: 'fixed', price: booking.amount, currency: booking.currency }) })} onPress={pay} busy={busy} />}
          <ErrorText text={problem} />
          <LinkText label={t('booking.payNotNow')} onPress={onClose} />
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  text: { fontSize: 16, color: '#1D1C4A' },
  backdrop: { flex: 1, backgroundColor: 'rgba(29,28,74,0.5)', justifyContent: 'center', padding: 24 },
  box: { backgroundColor: '#fff', borderRadius: 8, padding: 20, gap: 14 },
})
