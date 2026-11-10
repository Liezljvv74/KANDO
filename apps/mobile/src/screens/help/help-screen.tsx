import type { HelpTopic } from '@kando/contract'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { ApiError } from '@/api/client'
import { getHelpTopics, searchHelpTopics } from '@/api/help'
import { Button, LinkText } from '@/components/auth-ui'
import { FeedbackForm } from '@/components/feedback-form'
import { ScreenBanner } from '@/components/screen-banner'
import { Empty, ErrorRetry, Loading } from '@/components/state-view'
import { useLoad } from '@/hooks/use-load'
import { getLang, t, useLang, type Key, type Lang } from '@/i18n'
import { goBack } from '@/lib/go'
import { debounce, groupTopics, searchQuery, searchView, SEARCH_DEBOUNCE_MS, SEARCH_MAX_CHARS, toggleOpen } from '@/lib/help'
import { color, font } from '@/theme'

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
  const search = useHelpSearch(lang)
  const [feedback, setFeedback] = useState(false)
  const view = searchView(search.query, search)

  return (
    <SafeAreaView style={styles.root} edges={['left', 'right', 'bottom']}>
      <ScreenBanner title={t('help.title')} hideHelp />
      <ScrollView contentContainerStyle={styles.content}>
        <LinkText label={t('common.back')} onPress={goBack} />
        <View style={styles.searchBox}>
          <TextInput
            value={search.text}
            onChangeText={search.setText}
            maxLength={SEARCH_MAX_CHARS}
            placeholder={t('help.search.placeholder')}
            placeholderTextColor={color.placeholder}
            accessibilityLabel={t('help.search.label')}
            returnKeyType="search"
            autoCorrect={false}
            style={styles.searchInput}
          />
          {search.text.length > 0 && (
            <Pressable accessibilityRole="button" accessibilityLabel={t('help.search.clear')} onPress={() => search.setText('')} hitSlop={8} style={styles.clear}>
              <Text style={styles.clearText}>×</Text>
            </Pressable>
          )}
        </View>
        {view === 'loading' && <Loading />}
        {view === 'error' && <ErrorRetry code={search.error!} onRetry={search.retry} />}
        {view === 'empty' && (
          <View style={styles.emptyBox}>
            <Empty text={t('help.search.empty')} />
            <Button label={t('help.search.feedback')} onPress={() => setFeedback(true)} />
          </View>
        )}
        {view === 'results' && (
          <View style={styles.group}>
            {search.topics!.map((topic) => (
              <TopicRow key={topic.slug} topic={topic} open={open.has(topic.slug)} onPress={() => setOpen((o) => toggleOpen(o, topic.slug))} />
            ))}
          </View>
        )}
        {view === 'list' && !data && (error ? <ErrorRetry code={error} onRetry={retry} /> : <Loading />)}
        {view === 'list' && data && data.length === 0 && <Empty text={t('help.empty')} />}
        {view === 'list' && layout?.opening && (
          <View style={styles.opening}>
            <Text style={styles.openingTitle} accessibilityRole="header">
              {layout.opening.title}
            </Text>
            <Text style={styles.body}>{layout.opening.body}</Text>
          </View>
        )}
        {view === 'list' && layout?.groups.map((g) => (
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
      <FeedbackForm visible={feedback} onClose={() => setFeedback(false)} />
    </SafeAreaView>
  )
}

/** The search box state: the text, the debounced query, and the answer for it (a newer search drops an older answer). */
function useHelpSearch(lang: Lang) {
  const [text, setText] = useState('')
  const [query, setQuery] = useState<string | null>(null)
  const [answer, setState] = useState<{ q: string | null; loading: boolean; error: string | null; topics: HelpTopic[] | null }>({ q: null, loading: false, error: null, topics: null })
  const state = answer.q === query ? answer : { loading: true, error: null, topics: null } // an answer for an older query is not shown for the new one
  const [attempt, setAttempt] = useState(0)
  const setQueryLater = useMemo(() => debounce(setQuery, SEARCH_DEBOUNCE_MS), [])
  useEffect(() => {
    const q = searchQuery(text)
    if (q === null) setQuery(null) // no query: the list shows at once
    else setQueryLater(q)
    return setQueryLater.cancel
  }, [text, setQueryLater])
  useEffect(() => {
    if (!query) return
    let live = true
    setState({ q: query, loading: true, error: null, topics: null })
    searchHelpTopics(query, getLang())
      .then((topics) => live && setState({ q: query, loading: false, error: null, topics }))
      .catch((e) => live && setState({ q: query, loading: false, error: e instanceof ApiError ? e.code : 'network', topics: null }))
    return () => {
      live = false
    }
  }, [query, lang, attempt])
  return { text, setText, query, ...state, retry: () => setAttempt((n) => n + 1) }
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
  searchBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: color.surface, borderRadius: 6, borderWidth: 1, borderColor: color.divider, minHeight: 48 },
  searchInput: { flex: 1, fontSize: 16, color: color.ink, paddingHorizontal: 12, paddingVertical: 10 },
  clear: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  clearText: { fontSize: 24, color: color.indigo },
  emptyBox: { gap: 4 },
  opening: { backgroundColor: color.surface, borderRadius: 6, borderWidth: 1, borderColor: color.divider, padding: 16, gap: 8 },
  openingTitle: { fontSize: 20, lineHeight: 26, fontFamily: font.heading, color: color.indigo },
  group: { gap: 8 },
  heading: { fontSize: 16, fontFamily: font.heading, color: color.indigo, marginTop: 8 },
  row: { backgroundColor: color.surface, borderRadius: 6, borderWidth: 1, borderColor: color.divider, paddingHorizontal: 12 },
  rowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingVertical: 12, minHeight: 44 },
  rowTitle: { flex: 1, fontSize: 16, fontWeight: '600', color: color.ink },
  chevron: { fontSize: 16, color: color.indigo },
  body: { fontSize: 15, lineHeight: 22, color: color.ink, paddingBottom: 12 },
})
