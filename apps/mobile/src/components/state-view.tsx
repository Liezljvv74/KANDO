import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'

import { Button } from '@/components/auth-ui'
import { errorText, t } from '@/i18n'
import { color } from '@/theme'

export const Loading = () => (
  <View style={styles.box}>
    <ActivityIndicator size="large" color={color.indigo} />
  </View>
)

export const Empty = ({ text }: { text: string }) => (
  <View style={styles.box}>
    <Text style={styles.text}>{text}</Text>
  </View>
)

export const ErrorRetry = ({ code, onRetry }: { code: string; onRetry: () => void }) => (
  <View style={styles.box}>
    <Text style={styles.text} accessibilityRole="alert">
      {errorText(code)}
    </Text>
    <Button label={t('common.retry')} onPress={onRetry} />
  </View>
)

const styles = StyleSheet.create({
  box: { padding: 16, gap: 12, alignItems: 'stretch', justifyContent: 'center' },
  text: { fontSize: 16, color: color.ink, textAlign: 'center' },
})
