import { useState } from 'react'
import { Share, StyleSheet, Text, View } from 'react-native'

import { ApiError } from '@/api/client'
import { exportInvoices } from '@/api/invoices'
import { Button, ErrorText, LinkText } from '@/components/auth-ui'
import { Actions, SmallButton } from '@/components/form-ui'
import { Select } from '@/components/select'
import { signOutGeneration } from '@/hooks/use-me'
import { errorText, t, useLang } from '@/i18n'
import { go } from '@/lib/go'
import { clampYear, exportYears, invoiceEntries } from '@/lib/invoices'
import { canDownload, downloadText } from '@/lib/save-file'
import { font } from '@/theme'

/** Account tab: invoices and receipts for everyone; commission invoices and the yearly CSV export (share sheet) for providers. */
export function InvoicesCard({ me }: { me: { isProvider: boolean } | null }) {
  useLang()
  const show = invoiceEntries(me)
  const [year, setYear] = useState(() => clampYear(new Date().getFullYear()))
  const [busy, setBusy] = useState(false)
  const [choosing, setChoosing] = useState(false) // web: Export asks "download or share" before it runs
  const [error, setError] = useState<string | null>(null)

  // Same handling as the account data export: shared as text, nothing shown when the account changed meanwhile.
  async function share(download = false) {
    if (busy) return
    setChoosing(false)
    const account = signOutGeneration()
    setBusy(true)
    setError(null)
    try {
      const csv = await exportInvoices(clampYear(year))
      if (account !== signOutGeneration()) return setBusy(false)
      if (download) downloadText(`invoices-${clampYear(year)}.csv`, csv)
      else await Share.share({ message: csv })
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
          <Button label={t('invoice.exportButton', { year })} onPress={() => (canDownload ? setChoosing((c) => !c) : share())} busy={busy} />
          {canDownload && choosing && (
            <Actions>
              <SmallButton label={t('invoice.exportDownload')} onPress={() => share(true)} disabled={busy} solid grow />
              <SmallButton label={t('invoice.exportShare')} onPress={() => share()} disabled={busy} grow />
            </Actions>
          )}
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#CFE6DC', borderRadius: 6, padding: 16, gap: 12 },
  heading: { fontSize: 17, fontFamily: font.heading, color: '#1D1C4A' },
  text: { fontSize: 15, lineHeight: 21, color: '#1D1C4A' },
})
