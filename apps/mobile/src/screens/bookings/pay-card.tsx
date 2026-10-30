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
      sessions.set(id, { openedAt: Date.now(), gaveUp: false })
      rerender((n) => n + 1)
    })
    return () => sub.remove()
  }, [id])

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
        mark({ openedAt: Date.now(), gaveUp: false })
      }
      onRefresh()
    } catch (e) {
      setProblem(paymentsProblem(e))
    }
    setBusy(false)
  }

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
  text: { fontSize: 16, color: '#14352E' },
  paid: { fontSize: 18, fontWeight: '700', color: '#0B6B54' },
})
