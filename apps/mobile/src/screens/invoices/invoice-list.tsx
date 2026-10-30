import type { Booking, PayLink } from '@kando/contract'
import * as WebBrowser from 'expo-web-browser'
import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text } from 'react-native'

import { ApiError } from '@/api/client'
import { invoicePdf, listInvoices } from '@/api/invoices'
import { ErrorText } from '@/components/auth-ui'
import { Card, FormScreen } from '@/components/form-ui'
import { Empty, ErrorRetry, Loading } from '@/components/state-view'
import { useLoad } from '@/hooks/use-load'
import { errorText, t, useLang } from '@/i18n'
import { formatDay } from '@/lib/booking-time'
import { formatPrice } from '@/lib/format'
import { invoiceForBooking, openPdf } from '@/lib/invoices'

export const money = (total: number, currency: string) => formatPrice({ priceType: 'fixed', price: total, currency })

/** Opens one PDF in the in-app browser; `problem` is the text to show when it fails. */
export function usePdf() {
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  async function open(id: string, get: () => Promise<PayLink>) {
    if (busy) return
    setBusy(id)
    setProblem(null)
    try {
      await openPdf(get, (url) => WebBrowser.openBrowserAsync(url))
    } catch (e) {
      setProblem(errorText(e instanceof ApiError ? e.code : ''))
    }
    setBusy(null)
  }
  return { busy, problem, open }
}

/** One document in a list: tapping it opens the PDF; a PDF still being prepared cannot be tapped yet. */
export function DocRow({ title, lines, ready, busy, onPress }: { title: string; lines: string[]; ready: boolean; busy: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!ready || busy}
      accessibilityRole="button"
      accessibilityLabel={[t('invoice.open', { name: title }), ...lines].join('. ')}
      accessibilityState={{ disabled: !ready, busy }}
      style={({ pressed }) => pressed && styles.pressed}>
      <Card>
        <Text style={styles.text}>{title}</Text>
        {lines.map((l) => (
          <Text key={l} style={styles.small}>
            {l}
          </Text>
        ))}
        {!ready && <Text style={styles.small}>{t('invoice.notReadyShort')}</Text>}
      </Card>
    </Pressable>
  )
}

/** The person's invoices and receipts, newest as the server sends them; also where an invoice push lands. */
export default function InvoiceList() {
  useLang()
  const { data, error, retry } = useLoad(listInvoices)
  const pdf = usePdf()
  const title = t('invoice.title')
  if (!data) return <FormScreen title={title}>{error ? <ErrorRetry code={error} onRetry={retry} /> : <Loading />}</FormScreen>
  return (
    <FormScreen title={title}>
      <ErrorText text={pdf.problem} />
      {data.length === 0 && <Empty text={t('invoice.none')} />}
      {data.map((i) => (
        <DocRow
          key={i.id}
          title={`${t(i.kind === 'receipt' ? 'invoice.receipt' : 'invoice.invoice')} ${i.number}`}
          lines={[t(i.role === 'customer' ? 'invoice.from' : 'invoice.to', { name: i.counterparty }), `${formatDay(i.issuedAt)} · ${money(i.total, i.currency)}`]}
          ready={i.pdfReady}
          busy={pdf.busy === i.id}
          onPress={() => pdf.open(i.id, () => invoicePdf(i.id))}
        />
      ))}
    </FormScreen>
  )
}

/** On a booking: its group's invoice or receipt once issued. Hidden while none exists or the list cannot be read. */
export function BookingInvoiceRow({ booking }: { booking: Pick<Booking, 'id' | 'parentBookingId'> }) {
  const [found, setFound] = useState<ReturnType<typeof invoiceForBooking>>(null)
  const pdf = usePdf()
  useEffect(() => {
    let live = true
    listInvoices().then((list) => live && setFound(invoiceForBooking(list, booking)), () => {})
    return () => {
      live = false
    }
  }, [booking])
  if (!found) return null
  const { invoice: i, label } = found
  return (
    <>
      <DocRow title={`${t(label)} ${i.number}`} lines={[`${formatDay(i.issuedAt)} · ${money(i.total, i.currency)}`]} ready={i.pdfReady} busy={pdf.busy === i.id} onPress={() => pdf.open(i.id, () => invoicePdf(i.id))} />
      <ErrorText text={pdf.problem} />
    </>
  )
}

const styles = StyleSheet.create({
  text: { fontSize: 16, fontWeight: '600', color: '#14352E' },
  small: { fontSize: 14, color: '#5C7A72' },
  pressed: { opacity: 0.6 },
})
