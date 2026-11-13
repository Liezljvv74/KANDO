import type { HelpTopic } from '@kando/contract'
import { useCallback, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { getHelpTopics } from '@/api/help'
import { ScreenBanner } from '@/components/screen-banner'
import { Empty, ErrorRetry, Loading } from '@/components/state-view'
import { useLoad } from '@/hooks/use-load'
import { getLang, t, useLang, type Key } from '@/i18n'
import { groupTopics, toggleOpen } from '@/lib/help'
import { color, foldArrow, font } from '@/theme'

/**
 * Help as a full screen (opened from the Help button of the banner and of Home, also when signed out): the opening topic
 * expanded at the top, then the other topics under six headings, each a row that opens and closes. The texts come from the
 * server in the app language; this screen only holds the chrome. Back returns to the screen it was opened from.
 */
export default function HelpScreen() {
  const lang = useLang() // the topics load again when the language changes
  const load = useCallback(() => getHelpTopics(getLang()), [lang])
  const { data, error, retry } = useLoad(load)
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const layout = data ? groupTopics(data) : null

  return (
    <SafeAreaView style={styles.root} edges={['left', 'right', 'bottom']}>
      <ScreenBanner title={t('help.title')} hideHelp />
      <ScrollView contentContainerStyle={styles.content}>
        {!data && (error ? <ErrorRetry code={error} onRetry={retry} /> : <Loading />)}
        {data && data.length === 0 && <Empty text={t('help.empty')} />}
        {layout?.opening && (
          <View style={styles.opening}>
            <Text style={styles.openingTitle} accessibilityRole="header">
              {layout.opening.title}
            </Text>
            <Text style={styles.body}>{layout.opening.body}</Text>
          </View>
        )}
        {layout?.groups.map((g) => (
          <View key={g.group} style={styles.group}>
            <Text style={styles.heading} accessibilityRole="header">
              {t(`help.group.${g.group}` as Key)}
            </Text>
            {g.topics.map((topic) => (
              <TopicRow key={topic.slug} topic={topic} open={open.has(topic.slug)} onPress={() => setOpen((o) => toggleOpen(o, topic.slug))} />
            ))}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  )
}

function TopicRow({ topic, open, onPress }: { topic: HelpTopic; open: boolean; onPress: () => void }) {
  return (
    <View style={styles.row}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={onPress} style={styles.rowHead}>
        <Text style={styles.rowTitle}>{topic.title}</Text>
        <Text style={styles.chevron}>{open ? '▾' : '▸'}</Text>
      </Pressable>
      {open && <Text style={styles.body}>{topic.body}</Text>}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  content: { padding: 16, gap: 16 },
  opening: { backgroundColor: color.surface, borderRadius: 6, borderWidth: 1, borderColor: color.divider, padding: 16, gap: 8 },
  openingTitle: { fontSize: 20, lineHeight: 26, fontFamily: font.heading, color: color.indigo },
  group: { gap: 8 },
  heading: { fontSize: 16, fontFamily: font.heading, color: color.indigo, marginTop: 8 },
  row: { backgroundColor: color.surface, borderRadius: 6, borderWidth: 1, borderColor: color.divider, paddingHorizontal: 12 },
  rowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingVertical: 12, minHeight: 44 },
  rowTitle: { flex: 1, fontSize: 16, fontWeight: '600', color: color.ink },
  chevron: { ...foldArrow, color: color.indigo },
  body: { fontSize: 15, lineHeight: 22, color: color.ink, paddingBottom: 12 },
})
