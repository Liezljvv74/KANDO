import { Stack, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { ProviderDetail } from '@kando/contract'

import { ApiError } from '@/api/client'
import { getProvider, getTranslation, photoSrc } from '@/api/providers'
import { Avatar } from '@/components/avatar'
import { ErrorRetry, Loading } from '@/components/state-view'
import { useCategories } from '@/hooks/use-categories'
import { getLang, t, useLang, type Key } from '@/i18n'
import { formatPrice } from '@/lib/format'
import { applyTexts } from '@/lib/translation'

export default function ProviderScreen() {
  useLang()
  const { slug } = useLocalSearchParams<{ slug: string }>()
  const { names } = useCategories()
  const [p, setP] = useState<ProviderDetail | null>(null)
  const [error, setError] = useState('')
  // The original stays here while the translation is shown; tapping the label line restores it.
  const [original, setOriginal] = useState<ProviderDetail | null>(null)
  const [busy, setBusy] = useState(false)
  const [translateError, setTranslateError] = useState(false)
  // The app draws edge to edge: without this the end of the page sits behind the phone's navigation bar.
  const { bottom } = useSafeAreaInsets()

  const load = useCallback(() => {
    setError('')
    setP(null)
    setOriginal(null)
    setTranslateError(false)
    getProvider(slug, getLang())
      .then(setP)
      .catch((e) => setError(e instanceof ApiError ? e.code : 'network'))
  }, [slug])
  useEffect(load, [load])

  const translate = () => {
    if (!p || busy) return
    setBusy(true)
    setTranslateError(false)
    getTranslation(slug, getLang())
      .then((texts) => {
        setOriginal(p)
        setP(applyTexts(p, texts))
      })
      .catch(() => setTranslateError(true))
      .finally(() => setBusy(false))
  }

  const options = (
    <Stack.Screen options={{ headerShown: true, title: p?.publicName ?? '', headerTintColor: '#0E8A6B', headerStyle: { backgroundColor: '#F2FBF8' } }} />
  )
  if (!p)
    return (
      <View style={styles.root}>
        {options}
        {error ? <ErrorRetry code={error} onRetry={load} /> : <Loading />}
      </View>
    )

  const skills = Array.isArray(p.skills) ? p.skills.filter((s): s is string => typeof s === 'string') : []
  // Stored one per line; shown as tags like the skills. Unique: a line typed twice in the admin panel would repeat.
  const strengths = [...new Set((p.strengths ?? '').split('\n').map((s) => s.trim()).filter(Boolean))]
  const checkedLine = `${t('provider.checkedDocuments')}: ${(p.checkedDocuments ?? []).map((d) => t(`doc.short.${d}` as Key)).join(', ')}`
  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.content, { paddingBottom: 16 + bottom }]}>
      {options}
      <View style={styles.header}>
        <Avatar name={p.publicName} url={p.photoUrl} size={88} />
        <View style={styles.headerText}>
          <View style={styles.titleRow}>
            <Text style={styles.name}>{p.publicName}</Text>
            {p.isNew && <Text style={styles.badge}>{t('badge.new')}</Text>}
          </View>
          {!!p.place && <Text style={styles.text}>{p.place}</Text>}
          <Text style={styles.text}>{p.categories.map((s) => names.get(s) ?? s).join(' · ')}</Text>
          {!!p.worksRemotely && <Text style={styles.small}>{t('provider.remote')}</Text>}
          {(p.checkedDocuments?.length ?? 0) > 0 && <Text style={styles.small}>{checkedLine}</Text>}
        </View>
      </View>

      {original ? (
        <Pressable accessibilityRole="button" onPress={() => { setP(original); setOriginal(null) }}>
          <Text style={styles.small}>{t('provider.translatedLabel')}</Text>
        </Pressable>
      ) : (
        p.translatable && (
          <View style={styles.translateBox}>
            <Pressable accessibilityRole="button" accessibilityState={{ busy, disabled: busy }} disabled={busy} onPress={translate} style={styles.translate}>
              {busy ? <ActivityIndicator color="#0E8A6B" accessibilityLabel={t('provider.translate')} /> : <Text style={styles.translateLabel}>{t('provider.translate')}</Text>}
            </Pressable>
            {translateError && (
              <Text style={styles.small} accessibilityRole="alert">
                {t('provider.translateError')}
              </Text>
            )}
          </View>
        )
      )}

      {!!p.bio && <Text style={styles.text}>{p.bio}</Text>}

      {strengths.length > 0 && (
        <Section title={t('provider.strengths')}>
          <View style={styles.tags}>
            {strengths.map((s) => (
              <Text key={s} style={styles.tag}>
                {s}
              </Text>
            ))}
          </View>
        </Section>
      )}

      {skills.length > 0 && (
        <Section title={t('provider.skills')}>
          <View style={styles.tags}>
            {skills.map((s) => (
              <Text key={s} style={styles.tag}>
                {s}
              </Text>
            ))}
          </View>
        </Section>
      )}

      {!!p.experience && (
        <Section title={t('provider.experience')}>
          <Text style={styles.text}>{p.experience}</Text>
        </Section>
      )}

      {p.services.length > 0 && (
        <Section title={t('provider.services')}>
          {p.services.map((s) => (
            <View key={s.id} style={styles.service}>
              <View style={styles.serviceText}>
                <Text style={styles.serviceTitle}>{s.title}</Text>
                {!!s.description && <Text style={styles.small}>{s.description}</Text>}
              </View>
              <Text style={styles.price}>{formatPrice(s)}</Text>
            </View>
          ))}
        </Section>
      )}

      {p.references.length > 0 && (
        <Section title={t('provider.references')}>
          {p.references.map((r) => (
            <View key={r.id} style={styles.reference}>
              <Text style={styles.serviceTitle}>{r.year ? `${r.clientName} (${r.year})` : r.clientName}</Text>
              <Text style={styles.small}>{r.description}</Text>
            </View>
          ))}
        </Section>
      )}

      {p.photos.some((ph) => photoSrc(ph.url)) && (
        <Section title={t('provider.portfolio')}>
          <View style={styles.grid}>
            {p.photos.map(
              (ph) => photoSrc(ph.url) && <Image key={ph.id} source={{ uri: photoSrc(ph.url)! }} accessibilityLabel={ph.alt ?? ''} style={styles.gridImage} />,
            )}
          </View>
        </Section>
      )}

      {p.providerType === 'business' && !!p.impressum && (
        <Section title={t('provider.impressum')}>
          <Text style={styles.small}>{p.impressum}</Text>
        </Section>
      )}

      <Pressable disabled accessibilityRole="button" accessibilityState={{ disabled: true }} style={styles.disabled}>
        <Text style={styles.disabledLabel}>{`${t('provider.sendRequest')} (${t('provider.comingSoon')})`}</Text>
      </Pressable>
    </ScrollView>
  )
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <View style={styles.section}>
    <Text style={styles.h2} accessibilityRole="header">
      {title}
    </Text>
    {children}
  </View>
)

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F2FBF8' },
  content: { padding: 16, gap: 12 },
  header: { flexDirection: 'row', gap: 16, alignItems: 'center' },
  headerText: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  name: { fontSize: 22, fontWeight: '700', color: '#14352E' },
  badge: { fontSize: 12, fontWeight: '700', color: '#fff', backgroundColor: '#0E8A6B', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  text: { fontSize: 16, lineHeight: 22, color: '#14352E' },
  small: { fontSize: 14, lineHeight: 20, color: '#14352E' },
  translateBox: { gap: 4, alignItems: 'flex-start' },
  translate: { minHeight: 44, minWidth: 44, borderRadius: 22, borderWidth: 1, borderColor: '#0E8A6B', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  translateLabel: { color: '#0E8A6B', fontSize: 14, fontWeight: '700' },
  section: { gap: 8 },
  h2: { fontSize: 18, fontWeight: '700', color: '#0E8A6B' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: { fontSize: 14, color: '#14352E', backgroundColor: '#fff', borderWidth: 1, borderColor: '#BFE3D8', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  service: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, backgroundColor: '#fff', borderRadius: 12, padding: 12 },
  serviceText: { flex: 1, gap: 2 },
  serviceTitle: { fontSize: 16, fontWeight: '600', color: '#14352E' },
  price: { fontSize: 15, fontWeight: '700', color: '#0E8A6B', textAlign: 'right', flexShrink: 0 },
  reference: { backgroundColor: '#fff', borderRadius: 12, padding: 12, gap: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  gridImage: { width: '31%', aspectRatio: 1, borderRadius: 8, backgroundColor: '#BFE3D8' },
  disabled: { minHeight: 44, borderRadius: 22, backgroundColor: '#BFE3D8', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  disabledLabel: { color: '#5C7A72', fontSize: 16, fontWeight: '700', textAlign: 'center' },
})
