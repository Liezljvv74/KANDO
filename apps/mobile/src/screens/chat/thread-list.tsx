import { Pressable, StyleSheet, Text } from 'react-native'

import { listThreads } from '@/api/chat'
import { Card, FormScreen } from '@/components/form-ui'
import { ErrorRetry, Loading } from '@/components/state-view'
import { useLoad } from '@/hooks/use-load'
import { t, useLang } from '@/i18n'
import { formatWhen } from '@/lib/booking-time'
import { go } from '@/lib/go'

/** The person's conversations, most recent first (the server's order). */
export default function ThreadList() {
  useLang()
  const { data, error, retry } = useLoad(listThreads)
  const title = t('chat.title')
  if (!data)
    return <FormScreen title={title}>{error ? <ErrorRetry code={error} onRetry={retry} /> : <Loading />}</FormScreen>
  return (
    <FormScreen title={title}>
      {data.length === 0 && <Text style={styles.small}>{t('chat.empty')}</Text>}
      {data.map((th) => (
        <Pressable key={th.id} onPress={() => go(`/threads/${th.id}`)} accessibilityRole="button" accessibilityLabel={th.otherName}>
          <Card>
            <Text style={styles.name}>{th.otherName}</Text>
            {th.lastMessageAt && <Text style={styles.small}>{formatWhen(th.lastMessageAt)}</Text>}
            {th.blocked && <Text style={styles.small}>{t('chat.blocked')}</Text>}
          </Card>
        </Pressable>
      ))}
    </FormScreen>
  )
}

const styles = StyleSheet.create({
  name: { fontSize: 16, fontWeight: '700', color: '#14352E' },
  small: { fontSize: 14, color: '#5C7A72' },
})
