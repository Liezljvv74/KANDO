import type { TimeProposal } from '@kando/contract'
import { useState } from 'react'

import { ApiError } from '@/api/client'
import { Button, ErrorText } from '@/components/auth-ui'
import { errorText } from '@/i18n'
import { buildProposal, emptyWhenWhere } from '@/lib/when-where'
import { BusyTimes } from '@/screens/bookings/busy-times'
import { useSavedAddress } from '@/screens/bookings/use-saved-address'
import { proposalError, WhenWhereFields } from '@/screens/bookings/when-where-fields'

const noUpdate = () => {}

/**
 * Date, time, duration and place of a proposed time; the server decides whether it is allowed. The fields are the shared
 * WhenWhereFields. `slug`: show the provider's busy times. `withDetails`: also ask for the address and a note (not for a counter).
 * `canRemote`: the provider works remotely, so the person may choose remote.
 */
export function TimeProposalForm({
  submitLabel,
  slug,
  canRemote,
  withDetails,
  initialOnSite = true,
  onSubmit,
}: {
  submitLabel: string
  slug?: string
  canRemote: boolean
  withDetails: boolean
  /** Where the on-site switch starts (an agreed time starts from the booking's place). */
  initialOnSite?: boolean
  onSubmit: (p: TimeProposal) => Promise<void>
}) {
  const [value, setValue] = useState(() => ({ ...emptyWhenWhere(), onSite: initialOnSite }))
  useSavedAddress(withDetails ? setValue : noUpdate) // the address starts from the saved account address, as in the request form
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    const built = buildProposal(value, { canRemote, withDetails })
    if (!built.ok) return setError(proposalError(built.error))
    setBusy(true)
    setError(null)
    try {
      await onSubmit(built.proposal)
    } catch (e) {
      setError(errorText(e instanceof ApiError ? e.code : ''))
    }
    setBusy(false)
  }

  return (
    <>
      {slug && <BusyTimes slug={slug} />}
      <WhenWhereFields value={value} onChange={setValue} canRemote={canRemote} withDetails={withDetails} disabled={busy} />
      <ErrorText text={error} />
      <Button label={submitLabel} onPress={submit} busy={busy} />
    </>
  )
}
