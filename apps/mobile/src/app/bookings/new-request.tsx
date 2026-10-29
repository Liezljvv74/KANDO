import { useLocalSearchParams } from 'expo-router'

import { FormScreen } from '@/components/form-ui'
import { t, useLang } from '@/i18n'
import { RequestForm } from '@/screens/bookings/request-form'

export default function NewRequest() {
  useLang()
  const { providerId, serviceId } = useLocalSearchParams<{ providerId: string; serviceId?: string }>()
  return (
    <FormScreen title={t('booking.requestQuote')}>
      <RequestForm providerId={providerId} serviceId={serviceId} />
    </FormScreen>
  )
}
