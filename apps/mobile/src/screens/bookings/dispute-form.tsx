import { useCallback, useState } from 'react'
import { StyleSheet, Text } from 'react-native'

import type { Booking } from '@kando/contract'

import { getDispute } from '@/api/bookings'
import { Button, ErrorText, Field, Info } from '@/components/auth-ui'
import { Card } from '@/components/form-ui'
import { useLoad } from '@/hooks/use-load'
import { useSubmit } from '@/hooks/use-submit'
import { t, type Key } from '@/i18n'
import { formatWhen } from '@/lib/booking-time'
import { formatPrice } from '@/lib/format'

/** A written text for our team or the other side: a reported problem, an objection to a no-show report, an additional task. */
export function DescriptionForm({ label, hint, submitLabel, onSubmit, onDone }: { label: string; hint?: string; submitLabel: string; onSubmit: (text: string) => Promise<unknown>; onDone: () => void }) {
  const [text, setText] = useState('')
  const { busy, problem, setProblem, submit } = useSubmit()
  const send = () => (text.trim() ? submit(() => onSubmit(text.trim()), onDone) : setProblem(t('booking.descriptionMissing')))
  return (
    <Card>
      {!!hint && <Info text={hint} />}
      <Field label={label} value={text} onChangeText={setText} multiline maxLength={2000} editable={!busy} />
      <ErrorText text={problem} />
      <Button label={submitLabel} onPress={send} busy={busy} />
    </Card>
  )
}

/** The open dispute in neutral words for both sides: why our team looks at it, what was written, and the decision date. */
export function DisputeInfo({ booking }: { booking: Booking }) {
  const fetch = useCallback(() => getDispute(booking.id), [booking.id])
  const { data: d } = useLoad(fetch)
  if (!d) return null
  return (
    <Card>
      <Text style={styles.title}>{t('dispute.title')}</Text>
      <Info text={t((d.reason === 'problem' && d.openedBy === 'provider' ? 'dispute.reason.problemProvider' : `dispute.reason.${d.reason}`) as Key)} />
      {!!d.description && <Text style={styles.quote}>{d.description}</Text>}
      {d.decision ? (
        <Info text={t(`dispute.decision.${d.decision}` as Key, { amount: formatPrice({ priceType: 'fixed', price: d.providerShare ?? 0, currency: booking.currency }) })} />
      ) : (
        <Info text={t('dispute.decideBy', { date: formatWhen(d.decideBy) })} />
      )}
      {!!d.decisionReason && <Text style={styles.quote}>{d.decisionReason}</Text>}
    </Card>
  )
}

const styles = StyleSheet.create({
  title: { fontSize: 18, fontWeight: '700', color: '#14352E' },
  quote: { fontSize: 15, color: '#5C7A72', fontStyle: 'italic' },
})
