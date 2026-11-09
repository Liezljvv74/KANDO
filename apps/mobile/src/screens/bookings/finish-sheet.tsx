import type { Booking } from '@kando/contract'

import { finishJob } from '@/api/bookings'
import { Button, ErrorText, Info } from '@/components/auth-ui'
import { Card } from '@/components/form-ui'
import { useSubmit } from '@/hooks/use-submit'
import { t } from '@/i18n'

/** The provider's "Job finished": then the customer's 7 days start. */
export function FinishSheet({ booking, onDone }: { booking: Booking; onDone: () => void }) {
  const { busy, problem, submit } = useSubmit()
  function send() {
    submit(() => finishJob(booking.id), onDone)
  }
  return (
    <Card>
      <Info text={t('booking.finishHint')} />
      <ErrorText text={problem} />
      <Button label={t('booking.finishSend')} onPress={send} busy={busy} />
    </Card>
  )
}
