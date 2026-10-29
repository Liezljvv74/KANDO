import type { TimeProposal } from '@kando/contract'
import { useState } from 'react'

import { ApiError } from '@/api/client'
import { AddressFields, EMPTY_ADDRESS } from '@/components/address-fields'
import { Button, ErrorText, Field } from '@/components/auth-ui'
import { SwitchRow } from '@/components/form-ui'
import { errorText, t } from '@/i18n'
import { toMinutes, toStartAt } from '@/lib/booking-time'
import { BusyTimes } from '@/screens/bookings/busy-times'

/**
 * Date, time, duration and place of a proposed time; the server decides whether it is allowed.
 * `slug`: show the provider's busy times. `withDetails`: also ask for the address and a note (not for a counter).
 * `canRemote`: the provider works remotely, so the person may choose remote.
 */
export function TimeProposalForm({
  submitLabel,
  slug,
  canRemote,
  withDetails,
  onSubmit,
}: {
  submitLabel: string
  slug?: string
  canRemote: boolean
  withDetails: boolean
  onSubmit: (p: TimeProposal) => Promise<void>
}) {
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [duration, setDuration] = useState('60')
  const [onSite, setOnSite] = useState(true)
  const [address, setAddress] = useState(EMPTY_ADDRESS)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    const startAt = toStartAt(date, time)
    const durationMin = toMinutes(duration)
    if (!startAt || durationMin === null) return setError(t('booking.invalidTime'))
    const wantsSite = !canRemote || onSite
    const postcode = address.postcode.trim()
    if (withDetails && wantsSite && !postcode) return setError(errorText('address-required')) // the server's rule, said before the trip
    const proposal: TimeProposal = {
      startAt,
      durationMin,
      onSite: wantsSite,
      ...(withDetails && wantsSite && postcode && { address: { postcode, ...(address.street.trim() && { street: address.street.trim() }), ...(address.city.trim() && { city: address.city.trim() }) } }),
      ...(withDetails && note.trim() && { note: note.trim() }),
    }
    setBusy(true)
    setError(null)
    try {
      await onSubmit(proposal)
    } catch (e) {
      setError(errorText(e instanceof ApiError ? e.code : ''))
    }
    setBusy(false)
  }

  return (
    <>
      {slug && <BusyTimes slug={slug} />}
      <Field label={t('booking.dateField')} value={date} onChangeText={setDate} placeholder="2027-01-31" keyboardType="numbers-and-punctuation" autoCapitalize="none" editable={!busy} />
      <Field label={t('booking.timeField')} value={time} onChangeText={setTime} placeholder="09:30" keyboardType="numbers-and-punctuation" autoCapitalize="none" editable={!busy} />
      <Field label={t('booking.durationField')} value={duration} onChangeText={setDuration} keyboardType="number-pad" editable={!busy} />
      {canRemote && <SwitchRow label={t('booking.onSite')} value={onSite} onChange={setOnSite} />}
      {withDetails && (!canRemote || onSite) && <AddressFields value={address} onChange={setAddress} disabled={busy} />}
      {withDetails && <Field label={t('booking.noteField')} value={note} onChangeText={setNote} multiline editable={!busy} />}
      <ErrorText text={error} />
      <Button label={submitLabel} onPress={submit} busy={busy} />
    </>
  )
}
