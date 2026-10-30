import type { Booking } from '@kando/contract'

import { cancelBooking } from '@/api/bookings'
import { Button, ErrorText, Info } from '@/components/auth-ui'
import { Card } from '@/components/form-ui'
import { useSubmit } from '@/hooks/use-submit'
import { t } from '@/i18n'
import { cancelStatement, type Viewer } from '@/lib/booking-status'

/** What cancelling now costs, stated before the person confirms (the server decides at the moment of the tap). */
export function CancelSheet({ booking, viewer, onDone, onClose }: { booking: Booking; viewer: Viewer; onDone: () => void; onClose: () => void }) {
  const { busy, problem, submit } = useSubmit()
  return (
    <Card>
      <Info text={cancelStatement(booking, viewer)} />
      <ErrorText text={problem} />
      <Button label={t('booking.cancelYes')} onPress={() => submit(() => cancelBooking(booking.id), onDone)} busy={busy} danger />
      <Button label={t('booking.keep')} onPress={onClose} disabled={busy} />
    </Card>
  )
}
