import { useState } from 'react'

import { createRequest } from '@/api/bookings'
import { ApiError } from '@/api/client'
import { Button, ErrorText, Field, Info } from '@/components/auth-ui'
import { errorText, t } from '@/i18n'
import { goReplace } from '@/lib/go'

/** "Request a quote": what needs doing and, optionally, a preferred day. */
export function RequestForm({ providerId, serviceId }: { providerId: string; serviceId?: string }) {
  const [description, setDescription] = useState('')
  const [preferredDate, setPreferredDate] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    const day = preferredDate.trim()
    if (!description.trim()) return setError(t('booking.descriptionMissing'))
    if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) return setError(t('booking.invalidDate'))
    setBusy(true)
    setError(null)
    try {
      const r = await createRequest({ providerId, ...(serviceId && { serviceId }), description: description.trim(), ...(day && { preferredDate: day }) })
      goReplace(`/bookings/request/${r.id}`)
    } catch (e) {
      setError(errorText(e instanceof ApiError ? e.code : ''))
      setBusy(false)
    }
  }

  return (
    <>
      <Info text={t('booking.requestHelp')} />
      <Field label={t('booking.description')} value={description} onChangeText={setDescription} multiline editable={!busy} />
      <Field label={t('booking.preferredDate')} value={preferredDate} onChangeText={setPreferredDate} placeholder="2027-01-31" keyboardType="numbers-and-punctuation" autoCapitalize="none" editable={!busy} />
      <ErrorText text={error} />
      <Button label={t('booking.sendRequest')} onPress={submit} busy={busy} />
    </>
  )
}
