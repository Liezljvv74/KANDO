import { useLocalSearchParams } from 'expo-router'

import { acceptQuote, answerBooking, createDirectBooking } from '@/api/bookings'
import { Info } from '@/components/auth-ui'
import { FormScreen } from '@/components/form-ui'
import { t, useLang } from '@/i18n'
import { formatWhen } from '@/lib/booking-time'
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

/** The customer accepts a quote by proposing a time. Whether the provider works remotely is not known here: the server says. */
export function AcceptQuoteScreen() {
  useLang()
  const { quoteId, expiresAt } = useLocalSearchParams<{ quoteId: string; expiresAt?: string }>()
  return (
    <FormScreen title={t('booking.proposeTitle')}>
      {!!expiresAt && <Info text={t('booking.acceptExpiry', { date: formatWhen(expiresAt) })} />}
      <TimeProposalForm canRemote withDetails submitLabel={t('booking.propose')} onSubmit={async (p) => toBooking((await acceptQuote(quoteId, p)).id)} />
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
