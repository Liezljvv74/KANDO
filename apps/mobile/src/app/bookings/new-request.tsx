import { useLocalSearchParams } from 'expo-router'

import { FormScreen } from '@/components/form-ui'
import { t, useLang } from '@/i18n'
import { RequestForm } from '@/screens/bookings/request-form'

export default function NewRequest() {
  useLang()
  const { providerId, serviceId, remote } = useLocalSearchParams<{ providerId: string; serviceId?: string; remote?: string }>()
  return (
    <FormScreen title={t('booking.requestQuote')}>
      <RequestForm providerId={providerId} serviceId={serviceId} canRemote={remote === '1'} />
    </FormScreen>
  )
}
