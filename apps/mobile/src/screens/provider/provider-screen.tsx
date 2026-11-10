import { Stack, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { ProviderDetail } from '@kando/contract'

import { ApiError } from '@/api/client'
import { getProvider, getTranslation, photoSrc } from '@/api/providers'
import { Avatar } from '@/components/avatar'
import { ScreenBanner } from '@/components/screen-banner'
import { ErrorRetry, Loading } from '@/components/state-view'
import { useCategories } from '@/hooks/use-categories'
import { getLang, t, useLang, type Key } from '@/i18n'
import { formatPrice, ratingBadge } from '@/lib/format'
import { applyTexts } from '@/lib/translation'
import { notifyOnly } from '@/lib/request-target'
import { color, font } from '@/theme'
import { NotifyMe } from '@/screens/provider/notify-me'
import { RequestButton, useCanRequest } from '@/screens/provider/request-actions'

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
  const canRequest = useCanRequest(slug)
  const waitlist = !!p && notifyOnly(p)

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
    <Stack.Screen options={{ headerShown: false }} />
  )
  if (!p)
    return (
      <View style={styles.root}>
        {options}
        <ScreenBanner title="" />
        {error ? <ErrorRetry code={error} onRetry={load} /> : <Loading />}
      </View>
    )

  const skills = Array.isArray(p.skills) ? p.skills.filter((s): s is string => typeof s === 'string') : []
  // Stored one per line; shown as tags like the skills. Unique: a line typed twice in the admin panel would repeat.
  const strengths = [...new Set((p.strengths ?? '').split('\n').map((s) => s.trim()).filter(Boolean))]
  const checkedLine = `${t('provider.checkedDocuments')}: ${(p.checkedDocuments ?? []).map((d) => t(`doc.short.${d}` as Key)).join(', ')}`
  return (
    <View style={styles.root}>
      {options}
      <ScreenBanner title={p.publicName} />
      <ScrollView style={styles.root} contentContainerStyle={[styles.content, { paddingBottom: 16 + bottom }]}>
      <View style={styles.header}>
        <Avatar name={p.publicName} url={p.photoUrl} size={88} />
        <View style={styles.headerText}>
          <View style={styles.titleRow}>
            {!p.rating && <Text style={styles.badge}>{ratingBadge(p.rating)}</Text>}
            {!!p.verified && <Text style={styles.badge}>{t('provider.verified')}</Text>}
          </View>
          {!!p.place && <Text style={styles.text}>{p.place}</Text>}
          <Text style={styles.text}>{p.categories.map((s) => names.get(s) ?? s).join(' · ')}</Text>
          {!!p.rating && <Text style={styles.small}>{t('provider.rating', { average: p.rating.average.toLocaleString(getLang()), count: p.rating.count })}</Text>}
          {/* Late cancellations and no-shows in the last 12 months; nothing is shown while there are none. */}
          {!!p.reliability && <Text style={styles.small}>{p.reliability === 1 ? t('provider.reliability.one') : t('provider.reliability.other', { n: p.reliability })}</Text>}
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
              {busy ? <ActivityIndicator color={color.indigo} accessibilityLabel={t('provider.translate')} /> : <Text style={styles.translateLabel}>{t('provider.translate')}</Text>}
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
                {canRequest && !waitlist && <RequestButton provider={p} service={s} />}
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

      {(p.reviews?.length ?? 0) > 0 && (
        <Section title={t('provider.reviews')}>
          {p.reviews!.map((r, i) => (
            <View key={i} style={styles.reference}>
              <Text style={styles.serviceTitle} accessibilityLabel={`${r.stars} / 5`}>
                {`${'★'.repeat(r.stars)}${'☆'.repeat(5 - r.stars)} · ${new Date(r.date).toLocaleDateString(getLang())}`}
              </Text>
              {!!r.text && <Text style={styles.small}>{r.text}</Text>}
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

      {canRequest && (waitlist ? <NotifyMe slug={slug} watching={!!p.watching} /> : p.services.length === 0 && <RequestButton provider={p} />)}
      </ScrollView>
    </View>
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
  root: { flex: 1, backgroundColor: color.bg },
  content: { padding: 16, gap: 12 },
  header: { flexDirection: 'row', gap: 16, alignItems: 'center' },
  headerText: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  name: { fontSize: 26, fontFamily: font.display, color: color.ink },
  badge: { fontSize: 12, fontWeight: '700', color: color.surface, backgroundColor: color.indigo, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  text: { fontSize: 16, lineHeight: 22, color: color.ink },
  small: { fontSize: 14, lineHeight: 20, color: color.ink },
  translateBox: { gap: 4, alignItems: 'flex-start' },
  translate: { minHeight: 44, minWidth: 44, borderRadius: 4, borderWidth: 1, borderColor: color.indigo, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  translateLabel: { color: color.indigo, fontSize: 14, fontWeight: '700' },
  section: { gap: 8 },
  h2: { fontSize: 20, fontFamily: font.heading, color: color.indigo },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: { fontSize: 14, color: color.ink, backgroundColor: color.surface, borderWidth: 1, borderColor: color.border, borderRadius: 4, paddingHorizontal: 10, paddingVertical: 4 },
  service: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, backgroundColor: color.surface, borderRadius: 6, borderWidth: 2, borderStyle: 'dashed', borderColor: color.indigo, padding: 12 },
  serviceText: { flex: 1, gap: 2 },
  serviceTitle: { fontSize: 16, fontWeight: '600', color: color.ink },
  price: { fontSize: 16, fontFamily: font.tag, color: color.indigo, textAlign: 'right', flexShrink: 0 },
  reference: { backgroundColor: color.surface, borderWidth: 2, borderStyle: 'dashed', borderColor: color.indigo, borderRadius: 6, padding: 12, gap: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  gridImage: { width: '31%', aspectRatio: 1, borderRadius: 6, backgroundColor: color.border },
})
