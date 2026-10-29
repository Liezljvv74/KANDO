import * as WebBrowser from 'expo-web-browser'
import { useState } from 'react'
import { StyleSheet, Text } from 'react-native'

import type { Booking } from '@kando/contract'

import { ApiError } from '@/api/client'
import { payBooking } from '@/api/payments'
import { ErrorText } from '@/components/auth-ui'
import { Card, SmallButton } from '@/components/form-ui'
import { errorText, t } from '@/i18n'
import { formatWhen } from '@/lib/booking-time'

/** "Pay now" opens the Stripe page in the in-app browser. iOS resolves when it is closed, Android right when it opens (the screen reloads when the app comes back to the front); the server confirms the payment itself. */
export function PayCard({ booking, onReturn }: { booking: Booking; onReturn: () => void }) {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  async function pay() {
    setBusy(true)
    setProblem(null)
    try {
      await WebBrowser.openBrowserAsync((await payBooking(booking.id)).url)
      onReturn()
    } catch (e) {
      setProblem(errorText(e instanceof ApiError ? e.code : ''))
    }
    setBusy(false)
  }
  return (
    <Card>
      {!!booking.payBy && <Text style={styles.text}>{t('bookingStatus.payBy', { date: formatWhen(booking.payBy) })}</Text>}
      <SmallButton label={t('booking.payNow')} onPress={pay} busy={busy} />
      <ErrorText text={problem} />
    </Card>
  )
}

/** The clear "Paid" state of a confirmed booking. */
export const PaidCard = () => (
  <Card done>
    <Text style={styles.paid}>{t('booking.paid')}</Text>
  </Card>
)

const styles = StyleSheet.create({
  text: { fontSize: 16, color: '#14352E' },
  paid: { fontSize: 18, fontWeight: '700', color: '#0B6B54' },
})
