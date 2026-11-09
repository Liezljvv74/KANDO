import { useState } from 'react'
import { Pressable, Share, StyleSheet, Text } from 'react-native'

import { ApiError } from '@/api/client'
import { exportInvoices } from '@/api/invoices'
import { Button, ErrorText } from '@/components/auth-ui'
import { Actions, Card, SectionHeader, SmallButton } from '@/components/form-ui'
import { Select } from '@/components/select'
import { signOutGeneration } from '@/hooks/use-me'
import { errorText, t, useLang } from '@/i18n'
import { go } from '@/lib/go'
import { clampYear, exportYears, invoiceEntries } from '@/lib/invoices'
import { downloadText } from '@/lib/save-file'
import { color, font } from '@/theme'

/** Account tab: invoices and receipts for everyone; commission invoices and the yearly CSV export (share sheet) for providers. */
export function InvoicesCard({ me }: { me: { isProvider: boolean } | null }) {
  useLang()
  const show = invoiceEntries(me)
  const [year, setYear] = useState(() => clampYear(new Date().getFullYear()))
  const [busy, setBusy] = useState(false)
  const [choosing, setChoosing] = useState(false) // Export asks "download or share" before it runs
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
      if (download) await downloadText(`invoices-${clampYear(year)}.csv`, csv)
      else await Share.share({ message: csv })
    } catch (e) {
      const code = e instanceof ApiError ? e.code : ''
      setError(code === 'BAD_YEAR' ? errorText(code) : t('invoice.exportFailed'))
    }
    setBusy(false)
  }

  return (
    <Card>
      <HeaderLink label={t('invoice.title')} onPress={() => go('/invoices')} />
      {show.commission && <HeaderLink label={t('invoice.commissionTitle')} onPress={() => go('/invoices/commission')} />}
      {show.export && (
        <>
          <SectionHeader title={t('invoice.exportHeading')} />
          <Text style={styles.text}>{t('invoice.exportHint')}</Text>
          <Select label={t('invoice.year')} options={exportYears().map((y) => ({ value: y, label: String(y) }))} value={year} onChange={setYear} />
          <ErrorText text={error} />
          <Button label={t('invoice.exportButton', { year })} onPress={() => setChoosing((c) => !c)} busy={busy} />
          {choosing && (
            <Actions>
              <SmallButton label={t('invoice.exportDownload')} onPress={() => share(true)} disabled={busy} solid grow />
              <SmallButton label={t('invoice.exportShare')} onPress={() => share()} disabled={busy} grow />
            </Actions>
          )}
        </>
      )}
    </Card>
  )
}

/** A card header that opens a screen: same look and left alignment as the other cards' headers, with an arrow at the right. */
function HeaderLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={label} onPress={onPress}>
      <SectionHeader title={label}>
        <Text accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.arrow}>→</Text>
      </SectionHeader>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  arrow: { fontSize: 18, fontFamily: font.heading, color: color.ink },
  text: { fontSize: 15, lineHeight: 21, color: color.ink },
})
