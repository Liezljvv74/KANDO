import { useState } from 'react'

import type { BookingRequest, QuoteInput } from '@kando/contract'

import { sendQuote } from '@/api/bookings'
import { ApiError } from '@/api/client'
import { Button, ErrorText, Field, Info } from '@/components/auth-ui'
import { SwitchRow } from '@/components/form-ui'
import { errorText, t } from '@/i18n'
import { parseAmount } from '@/lib/amount'
import { buildQuoteTime, whenFromRequest } from '@/lib/when-where'
import { proposalError, WhenWhereFields } from '@/screens/bookings/when-where-fields'

/**
 * The provider's answer: price, scope and the time. The time starts as the customer asked; "Date and time confirmed" (on when the
 * request has a time) sends it with the quote, off sends a quote that says the time is still to be confirmed.
 */
export function SendQuoteForm({ request, onSent }: { request: BookingRequest; onSent: () => void }) {
  const [amount, setAmount] = useState('')
  const [scope, setScope] = useState('')
  const [confirmed, setConfirmed] = useState(request.startAt !== null)
  const [when, setWhen] = useState(() => whenFromRequest(request))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    const value = parseAmount(amount)
    if (value === null) return setError(t('booking.invalidAmountFormat'))
    if (!scope.trim()) return setError(t('booking.invalidAmount'))
    const built = buildQuoteTime(when, confirmed)
    if (!built.ok) return setError(proposalError(built.error))
    const body: QuoteInput = { amount: value, scope: scope.trim(), ...built.time }
    setBusy(true)
    setError(null)
    try {
      await sendQuote(request.id, body)
      setAmount('')
      setScope('')
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
      <SwitchRow label={t('booking.timeConfirmed')} value={confirmed} onChange={setConfirmed} />
      {confirmed ? <WhenWhereFields value={when} onChange={setWhen} canRemote={false} withDetails={false} disabled={busy} /> : <Info text={t('booking.timeToBeConfirmed')} />}
      <ErrorText text={error} />
      <Button label={t('booking.sendQuote')} onPress={submit} busy={busy} />
    </>
  )
}
