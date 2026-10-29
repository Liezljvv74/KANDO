import { useCallback } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { getBusyTimes } from '@/api/bookings'
import { ErrorRetry, Loading } from '@/components/state-view'
import { useLoad } from '@/hooks/use-load'
import { t } from '@/i18n'
import { formatWhen } from '@/lib/booking-time'

const DAYS = 30

/** When the provider is already taken, as times only. */
export function BusyTimes({ slug }: { slug: string }) {
  const fetch = useCallback(() => getBusyTimes(slug, new Date(), new Date(Date.now() + DAYS * 86_400_000)), [slug])
  const { data, error, retry } = useLoad(fetch)
  if (error && !data) return <ErrorRetry code={error} onRetry={retry} />
  if (!data) return <Loading />
  return (
    <View style={styles.box}>
      <Text style={styles.title} accessibilityRole="header">
        {t('busy.title')}
      </Text>
      {data.length === 0 && <Text style={styles.text}>{t('busy.none')}</Text>}
      {data.map((b) => (
        <Text key={`${b.startAt}-${b.endAt}`} style={styles.text}>
          {`${formatWhen(b.startAt)} - ${formatWhen(b.endAt)} (${t(b.state === 'pending' ? 'busy.pending' : 'busy.booked')})`}
        </Text>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  box: { gap: 4 },
  title: { fontSize: 16, fontWeight: '700', color: '#0E8A6B' },
  text: { fontSize: 14, color: '#14352E' },
})
