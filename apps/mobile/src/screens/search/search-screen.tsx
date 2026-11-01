import { useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, FlatList, StyleSheet, Text, View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { SafeAreaView } from 'react-native-safe-area-context'

import type { SearchItem } from '@kando/contract'

import { ApiError } from '@/api/client'
import { searchProviders, type SearchParams } from '@/api/providers'
import { Button, ErrorText, Field, KEYBOARD_GAP } from '@/components/auth-ui'
import { Empty, ErrorRetry, Loading } from '@/components/state-view'
import { useCategories } from '@/hooks/use-categories'
import { t, useLang } from '@/i18n'
import { CategorySelect } from './category-select'
import { ProviderCard } from './provider-card'

type Filters = Omit<SearchParams, 'page'>

export default function SearchScreen() {
  useLang()
  const { categories, names, error: categoriesError, retry: retryCategories } = useCategories()
  const [category, setCategory] = useState<string | null>(null)
  const [postcode, setPostcode] = useState('')
  const [q, setQ] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const [applied, setApplied] = useState<Filters>({})
  const [items, setItems] = useState<SearchItem[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading')
  const [error, setError] = useState('')
  const [loadingMore, setLoadingMore] = useState(false)
  const latest = useRef(0) // Only the newest request may update the list.
  const appliedRef = useRef<Filters>({}) // The filters of the list on screen, for the refresh on return.

  const load = useCallback(async (filters: Filters, next: number) => {
    const id = ++latest.current
    if (next === 1) setStatus('loading')
    else setLoadingMore(true)
    try {
      const result = await searchProviders({ ...filters, page: next })
      if (id !== latest.current) return
      setItems((prev) => (next === 1 ? result.items : [...prev, ...result.items]))
      setPage(result.page)
      setHasMore(result.hasMore)
      setStatus('ok')
      setError('')
    } catch (e) {
      if (id !== latest.current) return
      setError(e instanceof ApiError ? e.code : 'network')
      // A failed "load more" keeps the list and shows the error under it.
      if (next === 1) setStatus('error')
    } finally {
      if (id === latest.current) setLoadingMore(false)
    }
  }, [])

  // The Start tab opens this tab with a category slug and a fresh `at` per pick; the tab stays mounted, so react to both.
  const { category: preset, at } = useLocalSearchParams<{ category?: string; at?: string }>()
  useEffect(() => {
    // A category from Home is a fresh search: clear the other fields so they match the results.
    if (preset) {
      setCategory(preset)
      setPostcode('')
      setQ('')
    }
    const filters = preset ? { category: preset } : {}
    setApplied(filters)
    appliedRef.current = filters
    load(filters, 1)
  }, [load, preset, at])

  // A provider suspended or unpublished while the user was elsewhere (the detail screen, the browser, another app)
  // must not stay on the list: re-run the search on every return to this tab and whenever the app comes to the front.
  const mounted = useRef(false)
  useFocusEffect(
    useCallback(() => {
      if (mounted.current) load(appliedRef.current, 1)
      mounted.current = true
      const sub = AppState.addEventListener('change', (s) => {
        if (s === 'active') load(appliedRef.current, 1)
      })
      return () => sub.remove()
    }, [load]),
  )

  const submit = () => {
    const code = postcode.trim()
    if (code && !/^\d{5}$/.test(code)) return setFormError(t('search.postcodeInvalid'))
    setFormError(null)
    const filters = { category, postcode: code, q }
    setApplied(filters)
    appliedRef.current = filters
    load(filters, 1)
  }

  const header = (
    <View style={styles.form}>
      <Text style={styles.title}>{t('search.title')}</Text>
      {categories ? (
        <CategorySelect categories={categories} value={category} onChange={setCategory} />
      ) : categoriesError ? (
        <ErrorRetry code={categoriesError} onRetry={retryCategories} />
      ) : (
        <Loading />
      )}
      <Field label={t('search.postcode')} value={postcode} onChangeText={setPostcode} keyboardType="number-pad" maxLength={5} />
      <Field label={t('search.text')} value={q} onChangeText={setQ} returnKeyType="search" onSubmitEditing={submit} maxLength={100} />
      <ErrorText text={formError} />
      <Button label={t('search.submit')} onPress={submit} busy={status === 'loading'} />
    </View>
  )

  const footer =
    status !== 'ok' ? null : error ? (
      <ErrorRetry code={error} onRetry={() => load(applied, page + 1)} />
    ) : loadingMore ? (
      <Loading />
    ) : hasMore ? (
      <Button label={t('search.more')} onPress={() => load(applied, page + 1)} />
    ) : null

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <FlatList
        data={status === 'ok' ? items : []}
        keyExtractor={(i) => i.slug}
        renderItem={({ item }) => <ProviderCard item={item} names={names} />}
        ListHeaderComponent={header}
        ListEmptyComponent={
          status === 'loading' ? <Loading /> : status === 'error' ? <ErrorRetry code={error} onRetry={() => load(applied, 1)} /> : <Empty text={t('search.empty')} />
        }
        ListFooterComponent={footer ?? undefined}
        contentContainerStyle={styles.list}
        renderScrollComponent={(props) => <KeyboardAwareScrollView {...props} bottomOffset={KEYBOARD_GAP} />}
        keyboardShouldPersistTaps="handled"
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F2FBF8' },
  list: { padding: 16, gap: 12 },
  form: { gap: 12, marginBottom: 4 },
  title: { fontSize: 22, fontWeight: '700', color: '#0E8A6B' },
})
