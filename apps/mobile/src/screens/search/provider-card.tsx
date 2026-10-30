import { router } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import type { SearchItem } from '@kando/contract'

import { Avatar } from '@/components/avatar'
import { formatDistance, formatPrice, ratingBadge } from '@/lib/format'

export function ProviderCard({ item, names }: { item: SearchItem; names: Map<string, string> }) {
  const meta = [item.fromPrice != null ? formatPrice({ priceType: 'from', price: item.fromPrice, currency: item.currency }) : null, formatDistance(item)]
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/provider/[slug]', params: { slug: item.slug } })}
      accessibilityRole="button"
      style={styles.card}
    >
      <Avatar name={item.publicName} url={item.photoUrl} />
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.name} numberOfLines={1}>
            {item.publicName}
          </Text>
          <Text style={styles.badge}>{ratingBadge(item.rating)}</Text>
        </View>
        <Text style={styles.sub} numberOfLines={1}>
          {item.categories.map((s) => names.get(s) ?? s).join(' · ')}
        </Text>
        <Text style={styles.meta}>{meta.filter(Boolean).join('  ·  ')}</Text>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', gap: 12, backgroundColor: '#fff', borderRadius: 16, padding: 14, alignItems: 'center' },
  body: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flexShrink: 1, fontSize: 17, fontWeight: '700', color: '#14352E' },
  badge: { fontSize: 12, fontWeight: '700', color: '#fff', backgroundColor: '#0E8A6B', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  sub: { fontSize: 14, color: '#14352E' },
  meta: { fontSize: 14, color: '#0E8A6B', fontWeight: '600' },
})
