import { useCallback, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import type { CommissionInvoice, Invoice } from '@kando/contract'

import { commissionInvoicePdf, invoicePdf, listCommissionInvoices, listInvoices } from '@/api/invoices'
import { Button, ErrorText } from '@/components/auth-ui'
import { SectionTitle } from '@/components/form-ui'
import { Empty, ErrorRetry } from '@/components/state-view'
import { useLoad } from '@/hooks/use-load'
import { t } from '@/i18n'
import { formatDay } from '@/lib/booking-time'
import { docLine, newestFirst } from '@/lib/invoices'
import { monthName } from '@/screens/invoices/commission-list'
import { money, usePdf } from '@/screens/invoices/invoice-list'
import { color } from '@/theme'

type Doc = ({ commission: false } & Invoice) | ({ commission: true } & CommissionInvoice)

/** One document on a line (number, other party, date, total); a tap opens its details and the PDF in place. */
function DocLine({ d, pdf }: { d: Doc; pdf: ReturnType<typeof usePdf> }) {
  const [open, setOpen] = useState(false)
  const label = d.commission ? t('invoice.commissionLabel') : t(d.kind === 'receipt' ? 'invoice.receipt' : 'invoice.invoice')
  const who = d.commission ? undefined : d.counterparty
  const details = [
    `${label} ${d.number}`,
    d.commission ? t('invoice.commissionMonth', { month: monthName(d.month) }) : t(d.role === 'customer' ? 'invoice.from' : 'invoice.to', { name: d.counterparty }),
    `${formatDay(d.issuedAt)} · ${money(d.total, d.currency)}`,
  ]
  return (
    <View style={styles.line}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen((o) => !o)}>
        <Text style={styles.small} numberOfLines={open ? undefined : 1}>
          {docLine([d.number, who, formatDay(d.issuedAt), money(d.total, d.currency)])}
        </Text>
      </Pressable>
      {open && (
        <View style={styles.details}>
          {details.map((l) => (
            <Text key={l} style={styles.small}>
              {l}
            </Text>
          ))}
          {d.pdfReady ? (
            <Button label={t('invoice.openShort')} a11yLabel={t('invoice.open', { name: `${label} ${d.number}` })} busy={pdf.busy === d.id} onPress={() => pdf.open(d.id, () => (d.commission ? commissionInvoicePdf(d.id) : invoicePdf(d.id)))} />
          ) : (
            <Text style={styles.small}>{t('invoice.notReadyShort')}</Text>
          )}
        </View>
      )}
    </View>
  )
}

/** "Invoices (n) ▸/▾" at the foot of the Jobs tab: folded, nothing is fetched; opened, every invoice (and a provider's commission invoices) as accordion lines. */
export function InvoicesFold({ provider }: { provider: boolean }) {
  const [open, setOpen] = useState(false)
  const pdf = usePdf()
  const fetch = useCallback(async () => {
    if (!open) return undefined
    const [inv, com] = await Promise.all([listInvoices(), provider ? listCommissionInvoices() : []])
    return newestFirst<Doc>(inv.map((i) => ({ ...i, commission: false as const })), com.map((c) => ({ ...c, commission: true as const })))
  }, [open, provider])
  const { data, error, retry } = useLoad(fetch)
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen((o) => !o)}>
        <SectionTitle text={`${data ? t('jobs.invoicesCount', { n: data.length }) : t('invoice.heading')} ${open ? '▾' : '▸'}`} />
      </Pressable>
      {open && <ErrorText text={pdf.problem} />}
      {open && data?.length === 0 && <Empty text={t('invoice.none')} />}
      {open && data?.map((d) => <DocLine key={d.id} d={d} pdf={pdf} />)}
      {open && error && <ErrorRetry code={error} onRetry={retry} />}
    </>
  )
}

const styles = StyleSheet.create({
  line: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.divider },
  details: { gap: 6, paddingTop: 6 },
  small: { fontSize: 14, color: color.inkMuted },
})
