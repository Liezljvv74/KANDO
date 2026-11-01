import { useLocalSearchParams } from 'expo-router'

import { answerBooking, createDirectBooking, enterAgreedTime } from '@/api/bookings'
import { FormScreen } from '@/components/form-ui'
import { t, useLang } from '@/i18n'
import { goReplace } from '@/lib/go'
import { TimeProposalForm } from '@/screens/bookings/time-proposal-form'

const toBooking = (id: string) => goReplace(`/bookings/${id}`)

/** "Book": a time for a fixed-price service. */
export function BookScreen() {
  useLang()
  const { slug, serviceId, remote } = useLocalSearchParams<{ slug: string; serviceId: string; remote?: string }>()
  return (
    <FormScreen title={t('booking.proposeTitle')}>
      <TimeProposalForm slug={slug} canRemote={remote === '1'} withDetails submitLabel={t('booking.propose')} onSubmit={async (p) => toBooking((await createDirectBooking({ ...p, serviceId })).id)} />
    </FormScreen>
  )
}

/** An awaiting-time booking: either side enters the date and time they agreed (in the chat); the other side confirms it. */
export function AgreedTimeScreen() {
  useLang()
  const { id } = useLocalSearchParams<{ id: string }>()
  return (
    <FormScreen title={t('booking.agreeTitle')}>
      <TimeProposalForm
        canRemote
        withDetails={false}
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
