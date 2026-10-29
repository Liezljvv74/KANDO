import { useLocalSearchParams } from 'expo-router'
import { useCallback, useState } from 'react'
import { StyleSheet, Text } from 'react-native'

import type { Booking } from '@kando/contract'

import { threadIdForBooking } from '@/api/chat'
import { answerBooking, listBookings, withdrawBooking } from '@/api/bookings'
import { ApiError } from '@/api/client'
import { Button, ErrorText } from '@/components/auth-ui'
import { Card, FormScreen } from '@/components/form-ui'
import { ErrorRetry, Loading } from '@/components/state-view'
import { PaidCard, PayCard } from '@/screens/bookings/pay-card'
import { OpenChat } from '@/screens/chat/open-chat'
import { useLoad } from '@/hooks/use-load'
import { errorText, t, useLang, type Key } from '@/i18n'
import { bookingActions, bookingStatusText, canPay, type BookingAction, type Viewer } from '@/lib/booking-status'
import { confirmDanger } from '@/lib/confirm'
import { formatWhen } from '@/lib/booking-time'
import { formatPrice } from '@/lib/format'
import { go } from '@/lib/go'

type Found = { booking: Booking; viewer: Viewer } | null

/** There is no read-one route: the booking is in the person's customer list or, for a provider, in the provider list. */
async function find(id: string): Promise<Found> {
  const mine = (await listBookings('customer')).find((b) => b.id === id)
  if (mine) return { booking: mine, viewer: 'customer' }
  const theirs = (await listBookings('provider')).find((b) => b.id === id)
  return theirs ? { booking: theirs, viewer: 'provider' } : null
}

const placeOf = (b: Booking) => {
  if (!b.onSite) return t('booking.remote')
  const a = b.address
  return a ? t('booking.onSiteAt', { address: [a.street, [a.postcode, a.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') }) : t('booking.onSiteShort')
}

/** A booking: plain-words status, the proposed time and the actions allowed now. */
export default function BookingDetail() {
  useLang()
  const { id } = useLocalSearchParams<{ id: string }>()
  const fetch = useCallback(() => find(id), [id])
  const { data, done, error, retry } = useLoad(fetch)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const title = t('booking.bookings')
  if (!done || !data)
    return (
      <FormScreen title={title}>
        {error || done ? <ErrorRetry code={error ?? 'Not found'} onRetry={retry} /> : <Loading />}
      </FormScreen>
    )
  const { booking: b, viewer } = data

  async function act(action: BookingAction) {
    if (action === 'counter') return go('/bookings/counter', { id: b.id })
    if ((action === 'decline' || action === 'withdraw') && !(await confirmDanger(t(action === 'decline' ? 'booking.confirmDecline' : 'booking.confirmWithdraw'), t(`booking.${action}` as Key)))) return
    setBusy(true)
    setProblem(null)
    try {
      await (action === 'withdraw' ? withdrawBooking(b.id) : answerBooking(b.id, { type: action }))
      retry()
    } catch (e) {
      setProblem(errorText(e instanceof ApiError ? e.code : ''))
    }
    setBusy(false)
  }

  return (
    <FormScreen title={title}>
      <Card>
        <Text style={styles.status}>{bookingStatusText(b, viewer)}</Text>
        <Text style={styles.text}>{`${t('booking.when')}: ${formatWhen(b.startAt)} (${b.durationMin} min)`}</Text>
        <Text style={styles.text}>{`${t('booking.amount')}: ${formatPrice({ priceType: 'fixed', price: b.amount, currency: b.currency })}`}</Text>
        <Text style={styles.text}>{`${t('booking.mode')}: ${placeOf(b)}`}</Text>
        {!!b.note && <Text style={styles.small}>{b.note}</Text>}
      </Card>
      {canPay(b, viewer) && <PayCard booking={b} onReturn={retry} />}
      {b.status === 'confirmed' && <PaidCard />}
      <OpenChat find={() => threadIdForBooking(b)} />
      <ErrorText text={problem} />
      {bookingActions(b, viewer).map((a) => (
        <Button key={a} label={t(`booking.${a}` as Key)} onPress={() => act(a)} busy={busy} danger={a === 'decline' || a === 'withdraw'} />
      ))}
    </FormScreen>
  )
}

const styles = StyleSheet.create({
  status: { fontSize: 18, fontWeight: '700', color: '#0E8A6B' },
  text: { fontSize: 16, color: '#14352E' },
  small: { fontSize: 14, color: '#5C7A72' },
})
