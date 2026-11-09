import { Image, StyleSheet, Text, View } from 'react-native'

import { photoSrc } from '@/api/providers'
import { initials } from '@/lib/format'
import { color } from '@/theme'

export function Avatar({ name, url, size = 56 }: { name: string; url: string | null; size?: number }) {
  const box = { width: size, height: size, borderRadius: size / 2 }
  const src = photoSrc(url)
  return src ? (
    <Image source={{ uri: src }} accessibilityLabel={name} style={[box, styles.photo]} />
  ) : (
    <View style={[box, styles.fallback]}>
      <Text style={[styles.initials, { fontSize: size / 2.6 }]}>{initials(name)}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  photo: { backgroundColor: color.border },
  fallback: { backgroundColor: color.border, alignItems: 'center', justifyContent: 'center' },
  initials: { fontWeight: '700', color: color.indigo },
})
