import { useLocalSearchParams } from 'expo-router'

import { answerBooking, enterAgreedTime } from '@/api/bookings'
import { FormScreen } from '@/components/form-ui'
import { t, useLang } from '@/i18n'
import { goReplace } from '@/lib/go'
import { TimeProposalForm } from '@/screens/bookings/time-proposal-form'

const toBooking = (id: string) => goReplace(`/bookings/${id}`)

/** An awaiting-time booking: either side enters the date and time they agreed (in the chat); the other side confirms it. */
export function AgreedTimeScreen() {
  useLang()
  const { id, onSite } = useLocalSearchParams<{ id: string; onSite?: string }>()
  return (
    <FormScreen title={t('booking.agreeTitle')}>
      <TimeProposalForm
        canRemote
        withDetails={false}
        initialOnSite={onSite !== '0'} // a remote job cannot become on-site (the server refuses it), so it starts as remote
        submitLabel={t('booking.enterTime')}
        onSubmit={async (p) => {
          await enterAgreedTime(id, { startAt: p.startAt, durationMin: p.durationMin, onSite: p.onSite })
          toBooking(id)
        }}
      />
    </FormScreen>
  )
}

/** A counter-proposal to the other side's time. */
export function CounterScreen() {
  useLang()
  const { id } = useLocalSearchParams<{ id: string }>()
  return (
    <FormScreen title={t('booking.counter')}>
      <TimeProposalForm
        canRemote
        withDetails={false}
        submitLabel={t('booking.propose')}
        onSubmit={async (p) => {
          await answerBooking(id, { type: 'counter', startAt: p.startAt, durationMin: p.durationMin, onSite: p.onSite })
          toBooking(id)
        }}
      />
    </FormScreen>
  )
}
