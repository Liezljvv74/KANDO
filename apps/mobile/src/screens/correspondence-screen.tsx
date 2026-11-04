import { useFocusEffect } from 'expo-router'
import { useCallback } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Tag } from '@/components/shop-ui'
import { loadMe, useMe } from '@/hooks/use-me'
import { t, useLang, type Key } from '@/i18n'
import { type Category, unseenCounts } from '@/lib/correspondence'
import { go } from '@/lib/go'
import { color, font } from '@/theme'

const ROWS: { category: Category; title: Key; href: '/bookings' | '/quotes' | '/threads' }[] = [
  { category: 'bookings', title: 'booking.myBookings', href: '/bookings' },
  { category: 'quotes', title: 'booking.quotes', href: '/quotes' },
  { category: 'messages', title: 'chat.title', href: '/threads' },
]

/** The Correspondence tab: requests and bookings, quotes and messages, each with the number of things not looked at yet. */
export default function CorrespondenceScreen() {
  useLang()
  const me = useMe()
  useFocusEffect(useCallback(() => { loadMe().catch(() => {}) }, []))
  const counts = unseenCounts(me?.notifications)
  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title} accessibilityRole="header">
          {t('tab.correspondence')}
        </Text>
        {ROWS.map(({ category, title, href }) => (
          <Pressable key={category} accessibilityRole="button" accessibilityLabel={counts[category] ? `${t(title)}, ${counts[category]}` : t(title)} onPress={() => go(href)} style={({ pressed }) => pressed && styles.pressed}>
            <Tag>
              <View style={styles.row}>
                <Text style={styles.rowTitle}>{t(title)}</Text>
                {counts[category] > 0 && (
                  <View style={styles.count}>
                    <Text style={styles.countText}>{counts[category]}</Text>
                  </View>
                )}
                <Text style={styles.rowTitle}>→</Text>
              </View>
            </Tag>
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  content: { padding: 16, gap: 12 },
  title: { fontFamily: font.display, fontSize: 30, color: color.indigo, marginBottom: 4 },
  pressed: { opacity: 0.75 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 36 },
  rowTitle: { fontFamily: font.heading, fontSize: 19, color: color.ink, flexShrink: 1 },
  count: { marginLeft: 'auto', minWidth: 28, height: 28, borderRadius: 14, paddingHorizontal: 8, backgroundColor: color.indigo, alignItems: 'center', justifyContent: 'center' },
  countText: { color: '#fff', fontWeight: '800', fontSize: 14 },
})
