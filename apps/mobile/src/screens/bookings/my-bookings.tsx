import { useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Pressable, StyleSheet, Text } from 'react-native'

import { listBookings, listRequests, type Role } from '@/api/bookings'
import { Button, ErrorText } from '@/components/auth-ui'
import { NotificationBanners } from '@/components/notification-banner'
import { Card, FormScreen, SectionTitle } from '@/components/form-ui'
import { ErrorRetry, Loading } from '@/components/state-view'
import { useLoad } from '@/hooks/use-load'
import { loadMe, useMe } from '@/hooks/use-me'
import { useMore } from '@/hooks/use-more'
import { t, useLang, type Key } from '@/i18n'
import { bookingStatusText } from '@/lib/booking-status'
import { formatWhen } from '@/lib/booking-time'
import { go } from '@/lib/go'
import { isBookingNotice } from '@/lib/notification-text'

/** "My requests and bookings": as customer, and as provider for people who offer services. */
export default function MyBookings() {
  useLang()
  const me = useMe()
  useFocusEffect(useCallback(() => { loadMe().catch(() => {}) }, []))
  const [role, setRole] = useState<Role>('customer')
  const fetch = useCallback(async () => ({ role, bookings: await listBookings(role), requests: await listRequests(role) }), [role])
  const { data, error, retry } = useLoad(fetch)
  const current = data?.role === role ? data : undefined
  const bookings = useMore(current?.bookings, (c) => listBookings(role, c))
  const requests = useMore(current?.requests, (c) => listRequests(role, c))
  const title = t('booking.myBookings')
  const switcher = me?.isProvider && (
    <>
      <Button label={t('booking.asCustomer')} onPress={() => setRole('customer')} disabled={role === 'customer'} />
      <Button label={t('booking.asProvider')} onPress={() => setRole('provider')} disabled={role === 'provider'} />
    </>
  )
  // Old data of the other view stays in `data` while the new one loads: show it only for the chosen view.
  if (!current)
    return (
      <FormScreen title={title}>
        {switcher}
        <NotificationBanners me={me} only={isBookingNotice} />
        {error ? <ErrorRetry code={error} onRetry={retry} /> : <Loading />}
      </FormScreen>
    )
  return (
    <FormScreen title={title}>
      {switcher}
      <NotificationBanners me={me} only={isBookingNotice} />
      <SectionTitle text={t('booking.bookings')} />
      {bookings.docs.map((b) => (
        <Pressable key={b.id} accessibilityRole="button" onPress={() => go(`/bookings/${b.id}`)}>
          <Card>
            <Text style={styles.text}>{formatWhen(b.startAt)}</Text>
            <Text style={styles.small}>{bookingStatusText(b, role)}</Text>
          </Card>
        </Pressable>
      ))}
      {bookings.next && <Button label={t('list.showMore')} onPress={bookings.showMore} busy={bookings.busy} />}
      <ErrorText text={bookings.problem} />
      <SectionTitle text={t('booking.requests')} />
      {requests.docs.map((r) => (
        <Pressable key={r.id} accessibilityRole="button" onPress={() => go(`/bookings/request/${r.id}`)}>
          <Card>
            <Text style={styles.text} numberOfLines={2}>
              {r.description}
            </Text>
            <Text style={styles.small}>{t(`requestStatus.${r.status}` as Key)}</Text>
          </Card>
        </Pressable>
      ))}
      {requests.next && <Button label={t('list.showMore')} onPress={requests.showMore} busy={requests.busy} />}
      <ErrorText text={requests.problem} />
      {bookings.docs.length + requests.docs.length === 0 && <Text style={styles.small}>{t('booking.none')}</Text>}
    </FormScreen>
  )
}

const styles = StyleSheet.create({
  text: { fontSize: 16, color: '#14352E' },
  small: { fontSize: 14, color: '#5C7A72' },
})
