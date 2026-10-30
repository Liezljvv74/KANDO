import { Pressable, StyleSheet, Text } from 'react-native'

import { listThreads } from '@/api/chat'
import { Button, ErrorText } from '@/components/auth-ui'
import { Card, FormScreen } from '@/components/form-ui'
import { ErrorRetry, Loading } from '@/components/state-view'
import { useLoad } from '@/hooks/use-load'
import { useMore } from '@/hooks/use-more'
import { t, useLang } from '@/i18n'
import { formatWhen } from '@/lib/booking-time'
import { go } from '@/lib/go'

const firstPage = () => listThreads()

/** The person's conversations, most recent first (the server's order). */
export default function ThreadList() {
  useLang()
  const { data, error, retry } = useLoad(firstPage)
  const more = useMore(data, listThreads)
  const title = t('chat.title')
  if (!data)
    return <FormScreen title={title}>{error ? <ErrorRetry code={error} onRetry={retry} /> : <Loading />}</FormScreen>
  return (
    <FormScreen title={title}>
      {more.docs.length === 0 && <Text style={styles.small}>{t('chat.empty')}</Text>}
      {more.docs.map((th) => (
        <Pressable key={th.id} onPress={() => go(`/threads/${th.id}`)} accessibilityRole="button" accessibilityLabel={th.otherName}>
          <Card>
            <Text style={styles.name}>{th.otherName}</Text>
            {th.lastMessageAt && <Text style={styles.small}>{formatWhen(th.lastMessageAt)}</Text>}
            {th.blocked && <Text style={styles.small}>{t('chat.blocked')}</Text>}
          </Card>
        </Pressable>
      ))}
      {more.next && <Button label={t('list.showMore')} onPress={more.showMore} busy={more.busy} />}
      <ErrorText text={more.problem} />
    </FormScreen>
  )
}

const styles = StyleSheet.create({
  name: { fontSize: 16, fontWeight: '700', color: '#14352E' },
  small: { fontSize: 14, color: '#5C7A72' },
})
