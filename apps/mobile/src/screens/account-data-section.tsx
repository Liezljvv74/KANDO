import { useState } from 'react'
import { Share, StyleSheet, Text, View } from 'react-native'

import { deleteAccount, getExport, type ExportFormat } from '@/api/account'
import { ApiError } from '@/api/client'
import { Button, ErrorText, Field, LinkText } from '@/components/auth-ui'
import { signOutGeneration } from '@/hooks/use-me'
import { useSession } from '@/hooks/use-session'
import { t, useLang } from '@/i18n'
import { accountError, emailMatches, exportText } from '@/lib/account-data'

/** Export of the person's data through the share sheet, and the deletion of the account behind a typed-email confirmation. */
export function AccountDataSection() {
  useLang()
  const { user, signOut } = useSession()
  const [confirming, setConfirming] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState<ExportFormat | 'delete' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function share(format: ExportFormat) {
    if (busy) return
    const account = signOutGeneration()
    setBusy(format)
    setError(null)
    try {
      const data = await getExport(format)
      if (account === signOutGeneration()) await Share.share({ message: exportText(data) }) // signed out meanwhile: nothing of that account is shown
    } catch (e) {
      setError(accountError('export', e instanceof ApiError ? e.code : ''))
    }
    setBusy(null)
  }

  async function remove() {
    if (busy || !user || !emailMatches(typed, user.email)) return
    setBusy('delete')
    setError(null)
    try {
      await deleteAccount(typed.trim())
    } catch (e) {
      setError(accountError('delete', e instanceof ApiError ? e.code : ''))
      return setBusy(null)
    }
    await signOut() // the account is gone: same local sign-out as the Log out button, back to the start screen
  }

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>{t('account.exportHeading')}</Text>
      <Text style={styles.text}>{t('account.exportHint')}</Text>
      <Button label={t('account.exportJson')} onPress={() => share('json')} busy={busy === 'json'} disabled={!!busy && busy !== 'json'} />
      <Button label={t('account.exportCsv')} onPress={() => share('csv')} busy={busy === 'csv'} disabled={!!busy && busy !== 'csv'} />
      <View style={styles.rule} />
      {confirming ? (
        <>
          <Text style={styles.danger}>{t('account.deleteHeading')}</Text>
          <Text style={styles.text}>{t('account.deleteWarning')}</Text>
          <Field label={t('account.deleteType')} value={typed} onChangeText={setTyped} placeholder={user?.email} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} editable={!busy} />
          <ErrorText text={error} />
          <Button label={t('account.deleteConfirm')} danger onPress={remove} busy={busy === 'delete'} disabled={!user || !emailMatches(typed, user.email) || (!!busy && busy !== 'delete')} />
          <LinkText label={t('account.deleteCancel')} onPress={() => (setConfirming(false), setTyped(''), setError(null))} />
        </>
      ) : (
        <>
          <ErrorText text={error} />
          <Button label={t('account.deleteOpen')} danger onPress={() => (setConfirming(true), setError(null))} disabled={!!busy} />
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, gap: 12, marginTop: 24 },
  heading: { fontSize: 18, fontWeight: '700', color: '#14352E' },
  danger: { fontSize: 18, fontWeight: '700', color: '#B3261E' },
  text: { fontSize: 15, lineHeight: 21, color: '#14352E' },
  rule: { height: 1, backgroundColor: '#BFE3D8', marginVertical: 4 },
})
