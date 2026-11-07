import * as WebBrowser from 'expo-web-browser'
import { useEffect, useRef, useState } from 'react'
import { AppState, Platform, StyleSheet, Text } from 'react-native'

import type { Booking } from '@kando/contract'

import { payBooking } from '@/api/payments'
import { ErrorText } from '@/components/auth-ui'
import { Card, SmallButton } from '@/components/form-ui'
import { errorText, t } from '@/i18n'
import type { Viewer } from '@/lib/booking-status'
import { formatWhen } from '@/lib/booking-time'
import { payCard } from '@/lib/pay-state'
import { useMe } from '@/hooks/use-me'
import { paymentsOff, paymentsProblem } from '@/lib/payments-off'
import { isHttps } from '@/lib/safe-url'
import { font } from '@/theme'

type Session = { openedAt: number | null; gaveUp: boolean }
/** Per booking, for this session only: when the pay link was last returned from, and whether the customer said they did not finish. */
const sessions = new Map<string, Session>()

/**
 * The pay area of a booking. "Pay now" opens the Stripe page in the in-app browser. The booking only becomes confirmed when the
 * webhook arrives, so after a return it shows "being confirmed" (not Pay now again). iOS resolves `openBrowserAsync` when the
 * browser closes; Android right when it opens, so there the return is the app coming back to the front (the screen reloads then too).
 */
export function PayPanel({ booking, viewer, onRefresh }: { booking: Booking; viewer: Viewer; onRefresh: () => void }) {
  const me = useMe()
  const [, rerender] = useState(0)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const waiting = useRef(false)
  const id = booking.id
  const mark = (s: Session) => {
    sessions.set(id, s)
    rerender((n) => n + 1)
  }
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active' || !waiting.current) return
      waiting.current = false
      if (booking.jobState) return onRefresh() // the server state decides what shows now
      sessions.set(id, { openedAt: Date.now(), gaveUp: false })
      rerender((n) => n + 1)
    })
    return () => sub.remove()
  }, [id, booking.jobState, onRefresh])

  async function pay() {
    setBusy(true)
    setProblem(null)
    try {
      const { url } = await payBooking(id)
      if (!isHttps(url)) throw new Error('bad link')
      sessions.set(id, { openedAt: null, gaveUp: false })
      waiting.current = true
      await WebBrowser.openBrowserAsync(url)
      if (Platform.OS === 'ios') {
        waiting.current = false
        if (!booking.jobState) mark({ openedAt: Date.now(), gaveUp: false })
      }
      onRefresh()
    } catch (e) {
      setProblem(paymentsProblem(e))
    }
    setBusy(false)
  }

  // The server state (jobState) decides: Pay now, or Pay again when the checkout did not go through. The card text is the state card above.
  const key = booking.jobState?.key
  if (booking.jobState) {
    if (viewer !== 'customer' || (key !== 'payment_due' && key !== 'checkout_not_completed')) return null
    return (
      <Card>
        {paymentsOff(me) ? <Text style={styles.text}>{errorText('PAYMENTS_OFF')}</Text> : <SmallButton label={t(key === 'checkout_not_completed' ? 'booking.payAgain' : 'booking.payNow')} onPress={pay} busy={busy} />}
        <ErrorText text={problem} />
      </Card>
    )
  }
  // An older server without jobState: the phone's own memory of the pay link decides.
  const s = sessions.get(id)
  const kind = payCard(booking, viewer, s?.openedAt ?? null, s?.gaveUp ?? false)
  if (kind === 'none') return null
  if (kind === 'paid')
    return (
      <Card done>
        <Text style={styles.paid}>{t('booking.paid')}</Text>
      </Card>
    )
  if (kind === 'expired')
    return (
      <Card>
        <Text style={styles.text}>{t('booking.payExpired')}</Text>
      </Card>
    )
  if (kind === 'confirming')
    return (
      <Card>
        <Text style={styles.text}>{t('booking.confirming')}</Text>
        <SmallButton label={t('booking.refresh')} onPress={onRefresh} />
        <SmallButton label={t('booking.notFinished')} onPress={() => mark({ openedAt: s?.openedAt ?? null, gaveUp: true })} />
      </Card>
    )
  return (
    <Card>
      {!!booking.payBy && <Text style={styles.text}>{t('bookingStatus.payBy', { date: formatWhen(booking.payBy) })}</Text>}
      {paymentsOff(me) ? (
        <Text style={styles.text}>{errorText('PAYMENTS_OFF')}</Text>
      ) : (
        <SmallButton label={t(kind === 'payAgain' ? 'booking.payAgain' : 'booking.payNow')} onPress={pay} busy={busy} />
      )}
      <ErrorText text={problem} />
    </Card>
  )
}

const styles = StyleSheet.create({
  text: { fontSize: 16, color: '#1D1C4A' },
  paid: { fontSize: 18, fontFamily: font.heading, color: '#1D1C4A' },
})
