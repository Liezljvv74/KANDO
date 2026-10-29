import { StyleSheet, Text, View } from 'react-native'

import type { Notification } from '@kando/contract'

import { Card, SmallButton } from '@/components/form-ui'
import { getLang, t } from '@/i18n'
import { notificationText, notificationUrl } from '@/lib/notification-text'
import { shareProfile } from '@/lib/share-profile'

/** One message with a dismiss ×; "your profile is live" also gets Share (`payload.url` is the link). A kind this app does not know renders nothing. */
export function NotificationBanner({ notification, canShare, onDismiss }: { notification: Notification; canShare: boolean; onDismiss: () => void }) {
  const text = notificationText(notification.kind)
  if (!text) return null
  const url = notificationUrl(notification)
  return (
    <Card>
      <View style={styles.row}>
        <Text style={styles.text}>{text}</Text>
        <Text style={styles.close} accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={onDismiss}>
          {'×'}
        </Text>
      </View>
      {canShare && url && <SmallButton label={t('setup.share')} onPress={() => shareProfile(url, getLang())} />}
    </Card>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  text: { flex: 1, fontSize: 16, fontWeight: '700', color: '#0E8A6B' },
  close: { fontSize: 28, lineHeight: 28, color: '#5C7A72', minWidth: 44, minHeight: 44, textAlign: 'center' },
})
