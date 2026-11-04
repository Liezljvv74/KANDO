import { useEffect } from 'react'
import { StyleSheet, Text, View, type ViewStyle } from 'react-native'
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSequence, withTiming } from 'react-native-reanimated'

import { color, font } from '@/theme'

/** A rubber stamp that thumps onto the page once (still if the phone has animations switched off). */
export function Stamp({ label, style }: { label: string; style?: ViewStyle }) {
  const reduced = useReducedMotion()
  const p = useSharedValue(reduced ? 1 : 0)
  useEffect(() => {
    if (reduced) return
    p.value = withDelay(400, withSequence(withTiming(1.12, { duration: 140, easing: Easing.out(Easing.exp) }), withTiming(1, { duration: 160 })))
  }, [p, reduced])
  const anim = useAnimatedStyle(() => ({ opacity: p.value > 0 ? 1 : 0, transform: [{ rotate: '-7deg' }, { scale: p.value === 0 ? 2 : 2 - p.value }] }))
  return (
    <Animated.View style={[styles.stamp, anim, style]} accessible accessibilityLabel={label}>
      <Text style={styles.stampText}>{label}</Text>
    </Animated.View>
  )
}

/** A shop price tag: white, dashed edge. `children` is the content. */
export const Tag = ({ children, style }: { children: React.ReactNode; style?: ViewStyle }) => <View style={[styles.tag, style]}>{children}</View>

/** The typewriter-style small label (KANDO tag, prices). */
export const tagText = { fontFamily: font.tag, color: color.ink } as const

/** Content rises into place once, staggered by `index`. */
export function Rise({ index = 0, children }: { index?: number; children: React.ReactNode }) {
  const reduced = useReducedMotion()
  const p = useSharedValue(reduced ? 1 : 0)
  useEffect(() => {
    if (!reduced) p.value = withDelay(120 + index * 110, withTiming(1, { duration: 520, easing: Easing.out(Easing.exp) }))
  }, [p, reduced, index])
  const anim = useAnimatedStyle(() => ({ opacity: p.value, transform: [{ translateY: (1 - p.value) * 22 }] }))
  return <Animated.View style={anim}>{children}</Animated.View>
}

const styles = StyleSheet.create({
  stamp: { alignSelf: 'flex-start', borderWidth: 3, borderColor: color.teal, borderRadius: 4, paddingHorizontal: 10, paddingVertical: 4 },
  stampText: { fontFamily: font.tag, fontSize: 15, letterSpacing: 1.5, color: color.teal, textTransform: 'uppercase' },
  tag: { backgroundColor: color.surface, borderWidth: 2, borderStyle: 'dashed', borderColor: color.indigo, borderRadius: 6, padding: 14 },
})
