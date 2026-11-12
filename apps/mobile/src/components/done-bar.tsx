import { StyleSheet, Text, View } from 'react-native'
import { KeyboardStickyView } from 'react-native-keyboard-controller'

import { Button } from '@/components/auth-ui'
import { t } from '@/i18n'
import { color } from '@/theme'

/** The fixed bar at the bottom of a form screen: the Done button, "Saved", and a message line (what is missing, or an error). */
export function DoneBar({ onPress, busy, saved, message }: { onPress: () => void; busy: boolean; saved: boolean; message: string | null }) {
  return (
    <KeyboardStickyView>
      <View style={styles.bar}>
        {saved && <Text style={styles.saved}>{t('account.saved')}</Text>}
        {!!message && <Text accessibilityRole="alert" style={styles.message}>{message}</Text>}
        <Button label={t('common.done')} onPress={onPress} disabled={busy} />
      </View>
    </KeyboardStickyView>
  )
}

const styles = StyleSheet.create({
  bar: { padding: 12, gap: 6, backgroundColor: color.bg, borderTopWidth: 1, borderTopColor: color.divider },
  saved: { color: color.success, fontWeight: '600', textAlign: 'center' },
  message: { color: color.ink, textAlign: 'center' },
})
