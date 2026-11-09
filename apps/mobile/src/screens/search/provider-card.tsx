import { router } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import type { SearchItem } from '@kando/contract'

import { Avatar } from '@/components/avatar'
import { color, font } from '@/theme'
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
  card: { flexDirection: 'row', gap: 12, backgroundColor: color.surface, borderRadius: 6, borderWidth: 2, borderStyle: 'dashed', borderColor: color.indigo, padding: 14, alignItems: 'center' },
  body: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flexShrink: 1, fontSize: 18, fontFamily: font.heading, color: color.ink },
  badge: { fontSize: 12, fontWeight: '700', color: color.surface, backgroundColor: color.indigo, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  sub: { fontSize: 14, color: color.ink },
  meta: { fontSize: 14, color: color.indigo, fontFamily: font.tag },
})
