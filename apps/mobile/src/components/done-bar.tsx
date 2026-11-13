import { StyleSheet, Text, View } from 'react-native'

import { Button } from '@/components/auth-ui'
import { t } from '@/i18n'
import { color } from '@/theme'

/** The bar at the bottom of a form screen: the Done button and a message line (what is missing, or an error). It stays at the bottom of the page; the keyboard covers it while typing (owner decision, 13 November 2026). */
export function DoneBar({ onPress, disabled = false, message }: { onPress: () => void; disabled?: boolean; message: string | null }) {
  return (
    <View style={styles.bar}>
      {!!message && <Text accessibilityRole="alert" style={styles.message}>{message}</Text>}
      <Button label={t('common.done')} onPress={onPress} disabled={disabled} />
    </View>
  )
}

const styles = StyleSheet.create({
  bar: { padding: 12, gap: 6, backgroundColor: color.bg, borderTopWidth: 1, borderTopColor: color.divider },
  message: { color: color.ink, textAlign: 'center' },
})
