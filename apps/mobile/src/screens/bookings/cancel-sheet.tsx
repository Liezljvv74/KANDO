import { useState } from 'react'

import type { Booking } from '@kando/contract'

import { cancelBooking } from '@/api/bookings'
import { Button, ErrorText, Info } from '@/components/auth-ui'
import { Card } from '@/components/form-ui'
import { useSubmit } from '@/hooks/use-submit'
import { t } from '@/i18n'
import { cancelStatement, cancelTap, type Viewer } from '@/lib/booking-status'

/** What cancelling now costs, stated before the person confirms (the server decides at the moment of the tap). */
export function CancelSheet({ booking, viewer, onDone, onClose }: { booking: Booking; viewer: Viewer; onDone: () => void; onClose: () => void }) {
  const { busy, problem, submit } = useSubmit()
  // What the person read; checked again at the tap, so a statement gone stale (the 24-hour mark passed) is never sent.
  const [shown, setShown] = useState(() => cancelStatement(booking, viewer))
  function tap() {
    const { send, statement } = cancelTap(shown, booking, viewer)
    if (send) submit(() => cancelBooking(booking.id), onDone)
    else setShown(statement)
  }
  return (
    <Card>
      <Info text={shown} />
      <ErrorText text={problem} />
      <Button label={t('booking.cancelYes')} onPress={tap} busy={busy} danger />
      <Button label={t('booking.keep')} onPress={onClose} disabled={busy} />
    </Card>
  )
}
