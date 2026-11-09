import { useEffect, useRef, useState } from 'react'

import { COMMISSION_RATE, type BookingRequest, type QuoteInput } from '@kando/contract'

import { sendQuote } from '@/api/bookings'
import { ApiError } from '@/api/client'
import { servicesApi } from '@/api/my-profile'
import { Button, ErrorText, Field, Info } from '@/components/auth-ui'
import { SwitchRow } from '@/components/form-ui'
import { useQuoteSteps } from '@/hooks/use-me'
import { errorText, t } from '@/i18n'
import { parseAmount, receiveFrom } from '@/lib/amount'
import { formatPrice } from '@/lib/format'
import { doQuoteStep } from '@/lib/do-quote-step'
import { paymentsProblem } from '@/lib/payments-off'
import { quoteBlocked } from '@/lib/quote-gate'
import { buildQuoteTime, whenFromRequest } from '@/lib/when-where'
import { QuoteGate } from '@/screens/bookings/quote-gate'
import { proposalError, WhenWhereFields } from '@/screens/bookings/when-where-fields'

/**
 * The provider's answer: price, scope and the time. The time starts as the customer asked; "Date and time confirmed" (on when the
 * request has a time) sends it with the quote, off sends a quote that says the time is still to be confirmed.
 */
export function SendQuoteForm({ request, onSent }: { request: BookingRequest; onSent: () => void }) {
  const [amount, setAmount] = useState('')
  const [scope, setScope] = useState('')
  // on only while the customer's time is still ahead; a time that has passed cannot be confirmed in a quote
  const [confirmed, setConfirmed] = useState(request.startAt !== null && new Date(request.startAt).getTime() > Date.now())
  const [when, setWhen] = useState(() => whenFromRequest(request))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // The shared /me copy (the job page waits for it before showing this form); each step updates it, so the gate clears itself. Without steps (an older server) the button stays usable; the server still refuses.
  const steps = useQuoteSteps().steps ?? []
  const blocked = quoteBlocked(steps)

  const stepping = useRef(false) // a double tap must not start Stripe or save twice
  async function doStep(step: (typeof steps)[number]) {
    if (stepping.current) return
    stepping.current = true
    setError(null)
    try {
      await doQuoteStep(step)
    } catch (e) {
      setError(paymentsProblem(e))
    }
    stepping.current = false
  }

  // a request for one of the provider's fixed-price services starts with that price (the provider can change it)
  useEffect(() => {
    if (!request.serviceId) return
    let live = true
    servicesApi.list().then(
      (list) => {
        const price = list.find((s) => s.id === request.serviceId && s.priceType === 'fixed')?.price
        if (live && price) setAmount((a) => a || String(price))
      },
      () => {},
    )
    return () => {
      live = false
    }
  }, [request.serviceId])

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
      {receiveFrom(amount, COMMISSION_RATE) !== null && <Info text={t('money.quotePreview', { amount: formatPrice({ priceType: 'fixed', price: receiveFrom(amount, COMMISSION_RATE)!, currency: 'EUR' }), rate: Math.round(COMMISSION_RATE * 100) })} />}
      <Field label={t('booking.quoteScope')} value={scope} onChangeText={setScope} multiline editable={!busy} />
      <SwitchRow label={t('booking.timeConfirmed')} value={confirmed} onChange={setConfirmed} />
      {confirmed ? <WhenWhereFields value={when} onChange={setWhen} canRemote={false} withDetails={false} disabled={busy} /> : <Info text={t('booking.timeToBeConfirmed')} />}
      <ErrorText text={error} />
      <Button label={t('booking.sendQuote')} onPress={submit} busy={busy} disabled={blocked} />
      {blocked && <QuoteGate steps={steps} onDo={doStep} />}
    </>
  )
}
