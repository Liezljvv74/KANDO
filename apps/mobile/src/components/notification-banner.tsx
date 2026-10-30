import { StyleSheet, Text, View } from 'react-native'

import type { Me, Notification } from '@kando/contract'

import { dismissNotification } from '@/hooks/use-me'
import { Card, SmallButton } from '@/components/form-ui'
import { getLang, t } from '@/i18n'
import { go } from '@/lib/go'
import { notificationTarget, notificationText, notificationThreadId, notificationUrl, splitBanners } from '@/lib/notification-text'
import { shareProfile } from '@/lib/share-profile'

/** One message with a dismiss ×; "your profile is live" also gets Share (`payload.url` is the link); "new message" gets Open (the thread). A kind this app does not know renders nothing. */
export function NotificationBanner({ notification, canShare, onDismiss }: { notification: Notification; canShare: boolean; onDismiss: () => void }) {
  const text = notificationText(notification.kind, notification.payload)
  if (!text) return null
  const url = notificationUrl(notification)
  const threadId = notificationThreadId(notification)
  const target = notificationTarget(notification)
  return (
    <Card>
      <View style={styles.row}>
        <Text style={styles.text}>{text}</Text>
        <Text style={styles.close} accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={onDismiss}>
          {'×'}
        </Text>
      </View>
      {threadId && <SmallButton label={t('notification.open')} onPress={() => go(`/threads/${threadId}`)} />}
      {target && <SmallButton label={t('notification.open')} onPress={() => go(target.path)} />}
      {canShare && url && <SmallButton label={t('setup.share')} onPress={() => shareProfile(url, getLang())} />}
    </Card>
  )
}

/** The newest few open messages with "+N more" for the rest; shared by the setup, account, home and bookings pages (`only` narrows the list). */
export function NotificationBanners({ me, canShare = false, only }: { me: Me | null; canShare?: boolean; only?: (n: Notification) => boolean }) {
  const { shown, more } = splitBanners(only ? (me?.notifications ?? []).filter(only) : (me?.notifications ?? []))
  return (
    <>
      {shown.map((n) => <NotificationBanner key={n.id} notification={n} canShare={canShare} onDismiss={() => dismissNotification(n.id).catch(() => {})} />)}
      {more > 0 && <Text style={styles.more}>{t('notification.more', { n: more })}</Text>}
    </>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  text: { flex: 1, fontSize: 16, fontWeight: '700', color: '#0E8A6B' },
  more: { textAlign: 'center', fontSize: 14, color: '#5C7A72' },
  close: { fontSize: 28, lineHeight: 28, color: '#5C7A72', minWidth: 44, minHeight: 44, textAlign: 'center' },
})
