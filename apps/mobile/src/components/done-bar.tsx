import { StyleSheet, Text, View } from 'react-native'

import { Button } from '@/components/auth-ui'
import { t } from '@/i18n'
import { color } from '@/theme'

/** The end of a form screen: the Done button and a message line (what is missing, or an error). It is the last thing in the scrolling page, not fixed to the screen: the person scrolls down to it (owner decision, 13 November 2026). */
export function DoneBar({ onPress, disabled = false, message }: { onPress: () => void; disabled?: boolean; message: string | null }) {
  return (
    <View style={styles.bar}>
      {!!message && <Text accessibilityRole="alert" style={styles.message}>{message}</Text>}
      <Button label={t('common.done')} onPress={onPress} disabled={disabled} />
    </View>
  )
}

const styles = StyleSheet.create({
  bar: { gap: 6, marginTop: 8 },
  message: { color: color.ink, textAlign: 'center' },
})
