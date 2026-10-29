import { useState } from 'react'

import type { QuoteInput } from '@kando/contract'

import { sendQuote } from '@/api/bookings'
import { ApiError } from '@/api/client'
import { Button, ErrorText, Field } from '@/components/auth-ui'
import { errorText, t } from '@/i18n'
import { parseAmount } from '@/lib/amount'
import { toMinutes, toStartAt } from '@/lib/booking-time'

/** The provider's quote: amount, scope and an optional time suggestion (the customer confirms the time when accepting). */
export function SendQuoteForm({ requestId, onSent }: { requestId: string; onSent: () => void }) {
  const [amount, setAmount] = useState('')
  const [scope, setScope] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [duration, setDuration] = useState('60')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    const value = parseAmount(amount)
    if (value === null) return setError(t('booking.invalidAmountFormat'))
    if (!scope.trim()) return setError(t('booking.invalidAmount'))
    const suggest = date.trim() || time.trim()
    const startAt = suggest ? toStartAt(date, time) : null
    const durationMin = toMinutes(duration)
    if (suggest && (!startAt || durationMin === null)) return setError(t('booking.invalidTime'))
    const body: QuoteInput = { amount: value, scope: scope.trim(), ...(startAt && durationMin !== null && { startAt, durationMin }) }
    setBusy(true)
    setError(null)
    try {
      await sendQuote(requestId, body)
      setAmount('')
      setScope('')
      setDate('')
      setTime('')
      onSent()
    } catch (e) {
      setError(errorText(e instanceof ApiError ? e.code : ''))
    }
    setBusy(false)
  }

  return (
    <>
      <Field label={t('booking.quoteAmount')} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" editable={!busy} />
      <Field label={t('booking.quoteScope')} value={scope} onChangeText={setScope} multiline editable={!busy} />
      <Field label={`${t('booking.quoteSuggestion')}: ${t('booking.dateField')}`} value={date} onChangeText={setDate} placeholder="2027-01-31" keyboardType="numbers-and-punctuation" autoCapitalize="none" editable={!busy} />
      <Field label={t('booking.timeField')} value={time} onChangeText={setTime} placeholder="09:30" keyboardType="numbers-and-punctuation" autoCapitalize="none" editable={!busy} />
      <Field label={t('booking.durationField')} value={duration} onChangeText={setDuration} keyboardType="number-pad" editable={!busy} />
      <ErrorText text={error} />
      <Button label={t('booking.sendQuote')} onPress={submit} busy={busy} />
    </>
  )
}
