import type { QuoteListItem } from '@kando/contract'
import { PixelRatio, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native'

import { confirmQuote } from '@/api/bookings'
import { listQuoteDocuments, quotePdf } from '@/api/quotes'
import { Button, ErrorText, LinkText } from '@/components/auth-ui'
import { Card, FormScreen, SectionTitle } from '@/components/form-ui'
import { Empty, ErrorRetry, Loading } from '@/components/state-view'
import { useLoad } from '@/hooks/use-load'
import { useSubmit } from '@/hooks/use-submit'
import { t, useLang } from '@/i18n'
import { formatDay, formatWhen } from '@/lib/booking-time'
import { confirmDanger } from '@/lib/confirm'
import { formatPrice } from '@/lib/format'
import { go, goReplace } from '@/lib/go'
import { acceptedRows, acceptSummary, openQuotes, otherQuotes, quoteLines, quoteWhen, splitQuotes, type AcceptedRow } from '@/lib/quotes'
import { DocRow, usePdf } from '@/screens/invoices/invoice-list'

/**
 * The person's quotes. As customer: every open quote is its own card with its own Accept button (so they see exactly what they
 * accept), a table of the accepted ones (a row opens the booking), and the other received quotes as documents. As provider: "Quotes
 * sent". A document row opens the PDF (the same way an invoice does; a PDF not stored yet is stored when its link is asked for).
 */
export default function QuoteList() {
  useLang()
  const { data, error, retry } = useLoad(listQuoteDocuments)
  const pdf = usePdf()
  const accepting = useSubmit()
  const title = t('booking.quotes')
  if (!data) return <FormScreen title={title}>{error ? <ErrorRetry code={error} onRetry={retry} /> : <Loading />}</FormScreen>
  const { received, sent } = splitQuotes(data)
  const now = new Date()
  const open = openQuotes(received, now)
  const accepted = acceptedRows(received)
  const others = otherQuotes(received, now)
  // The customer reads provider, service, price and time before the call; the booking opens at once on success.
  const accept = async (q: QuoteListItem) => {
    if (!(await confirmDanger(acceptSummary(q), t('quote.acceptYes'), false))) return
    accepting.submit(async () => {
      try {
        goReplace(`/bookings/${(await confirmQuote(q.quoteId)).id}`)
      } catch (e) {
        retry() // the quote may have lapsed or been replaced meanwhile: the list shows what is open now
        throw e
      }
    })
  }
  const rows = (list: QuoteListItem[]) =>
    list.map((q) => <Row key={q.id} q={q} now={now} busy={pdf.busy === q.id} onPdf={() => pdf.open(q.id, () => quotePdf(q.id))} />)
  return (
    <FormScreen title={title}>
      <ErrorText text={pdf.problem} />
      <ErrorText text={accepting.problem} />
      {data.length === 0 && <Empty text={t('quote.none')} />}
      {open.length > 0 && <SectionTitle text={t('quote.openTitle')} />}
      {open.map((q) => (
        <OfferCard key={q.id} q={q} busy={accepting.busy} onAccept={() => accept(q)} onPdf={() => pdf.open(q.id, () => quotePdf(q.id))} />
      ))}
      {accepted.length > 0 && <SectionTitle text={t('quote.acceptedTitle')} />}
      {accepted.length > 0 && <AcceptedTable rows={accepted} />}
      {others.length > 0 && <SectionTitle text={t('quote.received')} />}
      {rows(others)}
      {sent.length > 0 && <SectionTitle text={t('quote.sent')} />}
      {rows(sent)}
    </FormScreen>
  )
}

/** One open quote with everything that is accepted by its button: provider, service, price, time, scope and last valid day. */
function OfferCard({ q, busy, onAccept, onPdf }: { q: QuoteListItem; busy: boolean; onAccept: () => void; onPdf: () => void }) {
  const total = formatPrice({ priceType: 'fixed', price: q.amount, currency: q.currency })
  return (
    <Card>
      <Text style={styles.title}>{q.counterparty}</Text>
      <Text style={styles.text}>{q.service ?? t('quote.noService')}</Text>
      <Text style={styles.amount}>{total}</Text>
      <Text style={styles.small}>{q.startAt ? t('booking.quoteSuggested', { when: quoteWhen(q) }) : quoteWhen(q)}</Text>
      <Text style={styles.text}>{q.scope}</Text>
      <Text style={styles.small}>{t('booking.quoteValidUntil', { date: formatWhen(q.expiresAt) })}</Text>
      <Button label={t('quote.accept')} a11yLabel={t('quote.acceptLabel', { number: q.number, provider: q.counterparty, price: total })} onPress={onAccept} busy={busy} />
      <LinkText label={t('invoice.open', { name: `${t('quote.label')} ${q.number}` })} onPress={onPdf} />
      <LinkText label={t('quote.openRequest')} onPress={() => go(`/bookings/request/${q.requestId}`)} />
    </Card>
  )
}

/** Below this width, or with large text, a row takes two lines (provider and service, then date and price) instead of four columns. */
const NARROW_WIDTH = 380
const LARGE_FONT_SCALE = 1.2

/** The accepted quotes: provider, date accepted, service, price. A row opens the booking. */
function AcceptedTable({ rows }: { rows: AcceptedRow[] }) {
  const { width } = useWindowDimensions()
  const stacked = width < NARROW_WIDTH || PixelRatio.getFontScale() > LARGE_FONT_SCALE
  return (
    <Card>
      {!stacked && (
        <View style={styles.tr}>
          <Text style={[styles.cell, styles.provider, styles.head]}>{t('quote.col.provider')}</Text>
          <Text style={[styles.cell, styles.date, styles.head]}>{t('quote.col.date')}</Text>
          <Text style={[styles.cell, styles.service, styles.head]}>{t('quote.col.service')}</Text>
          <Text style={[styles.cell, styles.price, styles.head]}>{t('quote.col.price')}</Text>
        </View>
      )}
      {rows.map((r) => {
        const service = r.service ?? (stacked ? t('quote.noService') : '-')
        const day = formatDay(r.bookedAt)
        return (
          <Pressable
            key={r.id}
            onPress={() => go(`/bookings/${r.bookingId}`)}
            accessibilityRole="button"
            accessibilityLabel={t('quote.openBooking', { number: r.number, provider: r.provider, service: r.service ?? t('quote.noService'), price: r.price, date: day })}
            style={({ pressed }) => [styles.body, pressed && styles.pressed]}>
            {stacked ? (
              <>
                <Text style={styles.cell}>{`${r.provider} · ${service}`}</Text>
                <View style={styles.tr}>
                  <Text style={[styles.cell, styles.date]}>{day}</Text>
                  <Text style={[styles.cell, styles.price]}>{r.price}</Text>
                </View>
              </>
            ) : (
              <View style={styles.tr}>
                <Text style={[styles.cell, styles.provider]}>{r.provider}</Text>
                <Text style={[styles.cell, styles.date]}>{day}</Text>
                <Text style={[styles.cell, styles.service]}>{service}</Text>
                <Text style={[styles.cell, styles.price]}>{r.price}</Text>
              </View>
            )}
          </Pressable>
        )
      })}
    </Card>
  )
}

function Row({ q, now, busy, onPdf }: { q: QuoteListItem; now: Date; busy: boolean; onPdf: () => void }) {
  return (
    <>
      <DocRow title={`${t('quote.label')} ${q.number}`} lines={quoteLines(q, now)} ready busy={busy} onPress={onPdf} />
      <LinkText label={t('quote.openRequest')} onPress={() => go(`/bookings/request/${q.requestId}`)} />
    </>
  )
}

const styles = StyleSheet.create({
  title: { fontSize: 18, fontWeight: '700', color: '#14352E' },
  text: { fontSize: 16, color: '#14352E' },
  amount: { fontSize: 20, fontWeight: '700', color: '#0E8A6B' },
  small: { fontSize: 14, color: '#5C7A72' },
  tr: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  body: { minHeight: 44, justifyContent: 'center', gap: 2, paddingVertical: 4, borderTopWidth: 1, borderTopColor: '#E3F1EC' },
  cell: { fontSize: 13, color: '#14352E' },
  head: { fontWeight: '700', color: '#5C7A72' },
  provider: { flex: 3 },
  date: { flex: 2.5 },
  service: { flex: 3 },
  price: { flex: 2, textAlign: 'right' },
  pressed: { opacity: 0.6 },
})
