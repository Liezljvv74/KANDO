import { useState } from 'react'

import type { Booking } from '@kando/contract'

import { finishJob } from '@/api/bookings'
import { Button, ErrorText, Field, Info } from '@/components/auth-ui'
import { Card } from '@/components/form-ui'
import { useSubmit } from '@/hooks/use-submit'
import { t } from '@/i18n'
import { parseAmountOrZero } from '@/lib/amount'

/** The provider's "Job finished": an optional material part of the price, then the customer's 7 days start. */
export function FinishSheet({ booking, onDone }: { booking: Booking; onDone: () => void }) {
  const [material, setMaterial] = useState('')
  const { busy, problem, setProblem, submit } = useSubmit()
  function send() {
    const typed = material.trim()
    const value = typed === '' ? null : parseAmountOrZero(typed)
    if (typed !== '' && value === null) return setProblem(t('booking.invalidAmountFormat'))
    // The route needs a JSON body: {} when no material part is given.
    submit(() => finishJob(booking.id, value === null ? {} : { materialAmount: value }), onDone)
  }
  return (
    <Card>
      <Info text={t('booking.finishHint')} />
      <Field label={t('booking.materialField')} value={material} onChangeText={setMaterial} keyboardType="decimal-pad" editable={!busy} />
      <ErrorText text={problem} />
      <Button label={t('booking.finishSend')} onPress={send} busy={busy} />
    </Card>
  )
}
