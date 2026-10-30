import { useState } from 'react'
import { Share, StyleSheet, Text, View } from 'react-native'

import { ApiError } from '@/api/client'
import { exportInvoices } from '@/api/invoices'
import { Button, ErrorText, LinkText } from '@/components/auth-ui'
import { Select } from '@/components/select'
import { signOutGeneration } from '@/hooks/use-me'
import { errorText, t, useLang } from '@/i18n'
import { go } from '@/lib/go'
import { clampYear, exportYears, invoiceEntries } from '@/lib/invoices'

/** Account tab: invoices and receipts for everyone; commission invoices and the yearly CSV export (share sheet) for providers. */
export function InvoicesCard({ me }: { me: { isProvider: boolean } | null }) {
  useLang()
  const show = invoiceEntries(me)
  const [year, setYear] = useState(() => clampYear(new Date().getFullYear()))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Same handling as the account data export: shared as text, nothing shown when the account changed meanwhile.
  async function share() {
    if (busy) return
    const account = signOutGeneration()
    setBusy(true)
    setError(null)
    try {
      const csv = await exportInvoices(clampYear(year))
      if (account === signOutGeneration()) await Share.share({ message: csv })
    } catch (e) {
      const code = e instanceof ApiError ? e.code : ''
      setError(code === 'BAD_YEAR' ? errorText(code) : t('invoice.exportFailed'))
    }
    setBusy(false)
  }

  return (
    <View style={styles.card}>
      <LinkText label={t('invoice.title')} onPress={() => go('/invoices')} />
      {show.commission && <LinkText label={t('invoice.commissionTitle')} onPress={() => go('/invoices/commission')} />}
      {show.export && (
        <>
          <Text style={styles.heading}>{t('invoice.exportHeading')}</Text>
          <Text style={styles.text}>{t('invoice.exportHint')}</Text>
          <Select label={t('invoice.year')} options={exportYears().map((y) => ({ value: y, label: String(y) }))} value={year} onChange={setYear} />
          <ErrorText text={error} />
          <Button label={t('invoice.exportButton', { year })} onPress={share} busy={busy} />
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, gap: 12 },
  heading: { fontSize: 17, fontWeight: '700', color: '#14352E' },
  text: { fontSize: 15, lineHeight: 21, color: '#14352E' },
})
