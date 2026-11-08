import type { IdScan } from '@kando/contract'
import { useState } from 'react'
import { Alert, StyleSheet, Text, View } from 'react-native'

import { scanIdCard } from '@/api/client'
import { Button, ErrorText } from '@/components/auth-ui'
import { errorText, t, useLang } from '@/i18n'
import { pickPhoto, uploadErrorCode } from '@/lib/pick'
import { DeniedNotice } from '@/screens/my-profile/denied-notice'

/**
 * "Scan your ID card to fill in your details": the camera or a photo from the library, one upload to POST /me/id-scan, and the
 * suggestions go to `onResult`. Nothing is saved here: the person checks the fields and saves the form, and typing everything in
 * stays possible. A short note says what happens to the photo before anything is sent.
 */
export function IdScanButton({ onResult, onBusy, disabled }: { onResult: (r: IdScan) => void; onBusy?: (busy: boolean) => void; disabled?: boolean }) {
  useLang()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [denied, setDenied] = useState(false)
  const [done, setDone] = useState(false)

  async function run(source: 'camera' | 'library') {
    setError(null)
    setDenied(false)
    setDone(false)
    setBusy(true)
    onBusy?.(true)
    try {
      const file = await pickPhoto(source, false)
      if (file === null) return
      if (file === 'denied') return setDenied(true)
      const result = await scanIdCard(file)
      if (!result.readable) return setError(t('idScan.unreadable'))
      onResult(result)
      setDone(true)
    } catch (e) {
      setError(errorText(uploadErrorCode(e)))
    } finally {
      setBusy(false)
      onBusy?.(false)
    }
  }

  const ask = () =>
    Alert.alert(t('idScan.source'), undefined, [
      { text: t('myProfile.photoTake'), onPress: () => run('camera') },
      { text: t('myProfile.photoChoose'), onPress: () => run('library') },
      { text: t('common.cancel'), style: 'cancel' },
    ])

  return (
    <View style={styles.box}>
      <Button label={busy ? t('idScan.working') : t('idScan.button')} onPress={ask} busy={busy} disabled={disabled || busy} />
      <Text style={styles.note}>{t('idScan.note')}</Text>
      {denied && <DeniedNotice />}
      <ErrorText text={error} />
      {done && <Text style={styles.done}>{t('idScan.check')}</Text>}
    </View>
  )
}

const styles = StyleSheet.create({
  box: { gap: 8 },
  note: { color: '#4F4E7D', fontSize: 13 },
  done: { color: '#1D1C4A', fontSize: 14, fontWeight: '600' },
})
