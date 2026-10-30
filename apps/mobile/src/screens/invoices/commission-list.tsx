import { commissionInvoicePdf, listCommissionInvoices } from '@/api/invoices'
import { ErrorText } from '@/components/auth-ui'
import { FormScreen } from '@/components/form-ui'
import { Empty, ErrorRetry, Loading } from '@/components/state-view'
import { useLoad } from '@/hooks/use-load'
import { getLang, t, useLang } from '@/i18n'
import { formatDay } from '@/lib/booking-time'
import { DocRow, money, usePdf } from '@/screens/invoices/invoice-list'

/** "2026-03" as "March 2026" in the app language. */
const monthName = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString(getLang(), { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/** The provider's monthly commission invoices from the platform. */
export default function CommissionList() {
  useLang()
  const { data, error, retry } = useLoad(listCommissionInvoices)
  const pdf = usePdf()
  const title = t('invoice.commissionTitle')
  if (!data) return <FormScreen title={title}>{error ? <ErrorRetry code={error} onRetry={retry} /> : <Loading />}</FormScreen>
  return (
    <FormScreen title={title}>
      <ErrorText text={pdf.problem} />
      {data.length === 0 && <Empty text={t('invoice.commissionNone')} />}
      {data.map((c) => (
        <DocRow
          key={c.id}
          title={`${t('invoice.commissionLabel')} ${c.number}`}
          lines={[t('invoice.commissionMonth', { month: monthName(c.month) }), `${formatDay(c.issuedAt)} · ${money(c.total, c.currency)}`]}
          ready={c.pdfReady}
          busy={pdf.busy === c.id}
          onPress={() => pdf.open(c.id, () => commissionInvoicePdf(c.id))}
        />
      ))}
    </FormScreen>
  )
}
