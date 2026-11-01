import type { QuoteListItem } from '@kando/contract'

import { listQuoteDocuments, quotePdf } from '@/api/quotes'
import { ErrorText, LinkText } from '@/components/auth-ui'
import { FormScreen, SectionTitle } from '@/components/form-ui'
import { Empty, ErrorRetry, Loading } from '@/components/state-view'
import { useLoad } from '@/hooks/use-load'
import { t, useLang } from '@/i18n'
import { go } from '@/lib/go'
import { quoteLines, splitQuotes } from '@/lib/quotes'
import { DocRow, usePdf } from '@/screens/invoices/invoice-list'

/**
 * The person's quote documents: "My received quotes" (as customer) and, for a provider, "Quotes sent". A row opens the PDF (the same
 * way an invoice does; a PDF not stored yet is stored when its link is asked for, so a row is always tappable); a link under it opens the request.
 */
export default function QuoteList() {
  useLang()
  const { data, error, retry } = useLoad(listQuoteDocuments)
  const pdf = usePdf()
  const title = t('booking.quotes')
  if (!data) return <FormScreen title={title}>{error ? <ErrorRetry code={error} onRetry={retry} /> : <Loading />}</FormScreen>
  const { received, sent } = splitQuotes(data)
  const rows = (list: QuoteListItem[]) =>
    list.map((q) => (
      <Row key={q.id} q={q} busy={pdf.busy === q.id} onPdf={() => pdf.open(q.id, () => quotePdf(q.id))} />
    ))
  return (
    <FormScreen title={title}>
      <ErrorText text={pdf.problem} />
      {data.length === 0 && <Empty text={t('quote.none')} />}
      {received.length > 0 && <SectionTitle text={t('quote.received')} />}
      {rows(received)}
      {sent.length > 0 && <SectionTitle text={t('quote.sent')} />}
      {rows(sent)}
    </FormScreen>
  )
}

function Row({ q, busy, onPdf }: { q: QuoteListItem; busy: boolean; onPdf: () => void }) {
  return (
    <>
      <DocRow title={`${t('quote.label')} ${q.number}`} lines={quoteLines(q)} ready busy={busy} onPress={onPdf} />
      <LinkText label={t('quote.openRequest')} onPress={() => go(`/bookings/request/${q.requestId}`)} />
    </>
  )
}
