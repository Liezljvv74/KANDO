import { useState } from 'react'

import type { Booking } from '@kando/contract'

import { answerStop, stateStopAmount } from '@/api/bookings'
import { Button, ErrorText, Field, Info } from '@/components/auth-ui'
import { Card } from '@/components/form-ui'
import { useSubmit } from '@/hooks/use-submit'
import { t } from '@/i18n'
import { parseAmountOrZero } from '@/lib/amount'
import { stopAnswerText } from '@/lib/booking-status'
import { confirmDanger } from '@/lib/confirm'
import { formatPrice } from '@/lib/format'

const price = (b: Booking, amount: number) => formatPrice({ priceType: 'fixed', price: amount, currency: b.currency })

/** After a stop the provider states what was earned (once, final); the customer agrees (payment) or disagrees (our team decides). */
export function StopSheet({ booking, mode, onDone }: { booking: Booking; mode: 'state' | 'answer'; onDone: () => void }) {
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const { busy, problem, setProblem, submit } = useSubmit()

  async function state() {
    const value = parseAmountOrZero(amount)
    if (value === null || value > booking.amount) return setProblem(t('booking.invalidStopAmount'))
    if (!(await confirmDanger(t('booking.stopFinalAsk', { amount: price(booking, value) }), t('booking.stopSend')))) return
    submit(() => stateStopAmount(booking.id, { amount: value, ...(note.trim() && { note: note.trim() }) }), onDone)
  }
  async function disagree() {
    if (await confirmDanger(t('booking.stopDisagreeAsk'), t('booking.stopDisagree'))) submit(() => answerStop(booking.id, false), onDone)
  }

  if (mode === 'answer')
    return (
      <Card>
        {!!booking.stopNote && <Info text={booking.stopNote} />}
        <Info text={stopAnswerText(booking)} />
        <ErrorText text={problem} />
        <Button label={t('booking.stopAgree')} onPress={() => submit(() => answerStop(booking.id, true), onDone)} busy={busy} />
        <Button label={t('booking.stopDisagree')} onPress={disagree} disabled={busy} />
      </Card>
    )
  return (
    <Card>
      <Field label={t('booking.stopAmountField')} hint={t('booking.stopAmountHint', { max: price(booking, booking.amount) })} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" editable={!busy} />
      <Field label={t('booking.stopNoteField')} value={note} onChangeText={setNote} multiline maxLength={1000} editable={!busy} />
      <ErrorText text={problem} />
      <Button label={t('booking.stopSend')} onPress={state} busy={busy} />
    </Card>
  )
}
