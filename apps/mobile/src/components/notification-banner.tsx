import { StyleSheet, Text, View } from 'react-native'

import type { Notification } from '@kando/contract'

import { Card, SmallButton } from '@/components/form-ui'
import { getLang, t } from '@/i18n'
import { shareProfile } from '@/lib/share-profile'

/** "Your profile is live" with Share and a dismiss ×; `payload.url` is the link. */
export function NotificationBanner({ notification, onDismiss }: { notification: Notification; onDismiss: () => void }) {
  return (
    <Card>
      <View style={styles.row}>
        <Text style={styles.text}>{t('setup.liveMessage')}</Text>
        <Text style={styles.close} accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={onDismiss}>
          {'×'}
        </Text>
      </View>
      <SmallButton label={t('setup.share')} onPress={() => shareProfile(notification.payload.url, getLang())} />
    </Card>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  text: { flex: 1, fontSize: 16, fontWeight: '700', color: '#0E8A6B' },
  close: { fontSize: 28, lineHeight: 28, color: '#5C7A72', minWidth: 44, minHeight: 44, textAlign: 'center' },
})
