import { useCallback } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import type { Booking } from '@kando/contract'

import { getBooking, getRequest } from '@/api/bookings'
import { Card } from '@/components/form-ui'
import { useLoad } from '@/hooks/use-load'
import { t, useLang } from '@/i18n'
import { formatAmount } from '@/lib/format'
import { moneyLines } from '@/lib/money-lines'
import { color } from '@/theme'

const PAID = ['confirmed', 'finished', 'completed', 'disputed', 'stopped']

/** The provider's money box under the status card: service, additional tasks that are paid, total paid, commission, what the provider receives. */
export function MoneyBox({ booking, taskIds }: { booking: Booking; taskIds: string[] }) {
  useLang()
  const key = taskIds.join(',')
  // each additional task is a request of its own: its current booking carries its amounts
  const load = useCallback(
    async () =>
      (await Promise.all(taskIds.map(async (id) => getBooking((await getRequest(id)).currentBookingId ?? '').then((v) => v.booking).catch(() => null)))).filter((b): b is Booking => !!b && PAID.includes(b.status)),
    [key],
  )
  const tasks = useLoad(load).data ?? []
  const lines = moneyLines(booking, tasks)
  if (!lines.length) return null
  return (
    <Card>
      <Text style={styles.title}>{t('money.box.title')}</Text>
      {lines.map((l, i) => (
        <View key={i} style={styles.row}>
          <Text style={[styles.text, i === lines.length - 1 && styles.bold]}>{l.label}</Text>
          <Text style={[styles.text, i === lines.length - 1 && styles.bold]}>{formatAmount(l.amount, booking.currency)}</Text>
        </View>
      ))}
    </Card>
  )
}

const styles = StyleSheet.create({
  title: { fontSize: 14, fontWeight: '600', color: color.indigo },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  text: { fontSize: 14, color: color.inkMuted, flexShrink: 1 },
  bold: { fontWeight: '700', color: color.ink },
})
