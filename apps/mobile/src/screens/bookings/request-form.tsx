import { useState } from 'react'
import { Alert } from 'react-native'

import { createRequest, getRequest } from '@/api/bookings'
import { sendPhoto } from '@/api/chat'
import { ApiError, type PickedFile } from '@/api/client'
import { Button, ErrorText, Field, Info } from '@/components/auth-ui'
import { errorText, t } from '@/i18n'
import { SmallButton } from '@/components/form-ui'
import { askPhotoSource } from '@/lib/ask-photo-source'
import { goReplace } from '@/lib/go'
import { pickPhoto } from '@/lib/pick'
import { buildProposal, emptyWhenWhere } from '@/lib/when-where'
import { useSavedAddress } from '@/screens/bookings/use-saved-address'
import { proposalError, WhenWhereFields } from '@/screens/bookings/when-where-fields'
import { DeniedNotice } from '@/screens/my-profile/denied-notice'

/**
 * "Request a quote": what needs doing, when and where (the shared WhenWhereFields; the address starts from the saved account
 * address, so the person need not type it again) and photos. The provider answers with a quote, with or without a final time.
 * `canRemote`: the provider works remotely (from the provider page), so the person may choose remote; otherwise the job is on site.
 */
export function RequestForm({ providerId, serviceId, canRemote }: { providerId: string; serviceId?: string; canRemote: boolean }) {
  const [description, setDescription] = useState('')
  const [when, setWhen] = useState(emptyWhenWhere())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [photos, setPhotos] = useState<PickedFile[]>([])
  const [denied, setDenied] = useState(false)

  useSavedAddress(setWhen) // the saved address fills the address fields once, while they are still empty

  async function addPhoto(source: 'camera' | 'library') {
    setDenied(false)
    try {
      const file = await pickPhoto(source, false)
      if (file === 'denied') setDenied(true)
      else if (file) setPhotos((p) => [...p, file])
    } catch {
      setError(errorText('Unsupported file type'))
    }
  }

  /** The photos go to the request's chat once the request exists; a photo that fails does not undo the request. */
  async function attachPhotos(requestId: string) {
    let failed = false
    try {
      const thread = (await getRequest(requestId)).threadId
      if (!thread) failed = true
      else for (const file of photos) await sendPhoto(thread, file).catch(() => (failed = true))
    } catch {
      failed = true
    }
    if (failed) Alert.alert(t('chat.photosFailed'))
  }

  async function submit() {
    if (!description.trim()) return setError(t('booking.descriptionMissing'))
    const built = buildProposal(when, { canRemote, withDetails: true })
    if (!built.ok) return setError(proposalError(built.error))
    setBusy(true)
    setError(null)
    try {
      const r = await createRequest({ providerId, ...(serviceId && { serviceId }), description: description.trim(), ...built.proposal })
      if (photos.length) await attachPhotos(r.id)
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
      <WhenWhereFields value={when} onChange={setWhen} canRemote={canRemote} withDetails disabled={busy} />
      <SmallButton label={t('chat.photosForRequest')} onPress={() => askPhotoSource(addPhoto)} disabled={busy} />
      {photos.length > 0 && <Info text={photos.length === 1 ? t('chat.photosAdded.one') : t('chat.photosAdded.other', { n: photos.length })} />}
      {denied && <DeniedNotice />}
      <ErrorText text={error} />
      <Button label={t('booking.sendRequest')} onPress={submit} busy={busy} />
    </>
  )
}
