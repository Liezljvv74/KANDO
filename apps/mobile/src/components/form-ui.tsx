import { useRouter } from 'expo-router'
import type { ComponentRef } from 'react'
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { SafeAreaView } from 'react-native-safe-area-context'

import { KEYBOARD_GAP, LinkText } from '@/components/auth-ui'
import { ScreenBanner } from '@/components/screen-banner'
import { t } from '@/i18n'
import { color, foldArrow, font } from '@/theme'

/** `scrollRef`: lets a screen scroll to one of its sections (y from that section's onLayout; sections are direct children). */
export function FormScreen({ title, children, back = true, scrollRef, footer }: { title: string; children: React.ReactNode; back?: boolean; scrollRef?: React.Ref<ComponentRef<typeof KeyboardAwareScrollView>>; footer?: React.ReactNode }) {
  const router = useRouter()
  return (
    <SafeAreaView style={styles.root} edges={['left', 'right', 'bottom']}>
      <ScreenBanner title={title} />
      <KeyboardAwareScrollView ref={scrollRef} contentContainerStyle={styles.content} bottomOffset={KEYBOARD_GAP} keyboardShouldPersistTaps="handled">
        {back && <LinkText label={t('common.back')} onPress={() => router.back()} />}
        {children}
        {footer}
      </KeyboardAwareScrollView>
    </SafeAreaView>
  )
}

/** Text colour on a green (complete) card: the brand green, darkened to stay readable on the tint. */
export const DONE_TEXT = color.ink

/** `done`: the card's compulsory information is complete, so it is tinted green. */
/** `list`: a row in a list or a summary (a booking, a quote, a thread, an invoice): the dashed price-tag look. Without it the card is a calm form container. */
export const Card = ({ children, done, list }: { children: React.ReactNode; done?: boolean; list?: boolean }) => (
  <View style={[styles.card, list && styles.cardList, done && styles.cardDone]}>{children}</View>
)

/** `arrow`: a fold arrow after the text (▾ open, ▸ closed), in the size all fold arrows have. */
export const SectionTitle = ({ text, tint, arrow }: { text: string; tint?: string; arrow?: string }) => (
  <Text style={[styles.section, tint ? { color: tint } : null]}>
    {text}
    {arrow ? <Text style={foldArrow}>{` ${arrow}`}</Text> : null}
  </Text>
)

export const SwitchRow = ({ label, value, onChange, disabled }: { label: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) => (
  <View style={styles.switchRow}>
    <Text style={[styles.label, styles.switchLabel]}>{label}</Text>
    <Switch value={value} onValueChange={onChange} disabled={disabled} accessibilityLabel={label} trackColor={{ true: color.indigo }} />
  </View>
)

/** Small outlined button (list rows and the My profile actions); `busy` shows a spinner and blocks presses. */
export const SmallButton = ({
  label,
  onPress,
  accessibilityLabel,
  disabled,
  busy,
  danger,
  solid,
  grow,
  badge,
}: {
  label: string
  onPress: () => void
  accessibilityLabel?: string
  disabled?: boolean
  busy?: boolean
  danger?: boolean
  /** Filled like the full-width Button (teal, or red with `danger`), only smaller. */
  solid?: boolean
  /** Shares a row equally with its neighbours (the label wraps when it must). */
  grow?: boolean
  /** Red text after the label, e.g. an unread count "(1)"; the button's line turns red with it. */
  badge?: string
}) => (
  <Pressable
    onPress={onPress}
    disabled={disabled || busy}
    accessibilityRole="button"
    accessibilityLabel={accessibilityLabel ?? label}
    accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }}
    style={({ pressed }) => [styles.small, grow && styles.smallGrow, solid && { backgroundColor: danger ? color.danger : color.teal, borderColor: danger ? color.danger : color.teal }, !solid && danger && { borderColor: color.danger }, !!badge && { borderColor: color.danger }, (disabled || busy) && styles.smallOff, pressed && styles.smallOff]}
  >
    <Text style={[styles.smallLabel, grow && styles.smallGrowLabel, solid && { color: danger ? color.surface : color.ink }, !solid && danger && { color: color.danger }]}>{label}{!!badge && <Text style={{ color: color.danger }}>{` ${badge}`}</Text>}</Text>
  </Pressable>
)

/** An icon-only button (44 pt touch area); `label` is what screen readers say ("Edit: Babysitting", "Add service"). */
export const IconButton = ({
  icon,
  label,
  onPress,
  busy,
  disabled,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name']
  label: string
  onPress: () => void
  busy?: boolean
  disabled?: boolean
}) => (
  <Pressable
    onPress={onPress}
    disabled={disabled || busy}
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }}
    hitSlop={4}
    style={({ pressed }) => [styles.icon, (pressed || disabled) && styles.smallOff]}
  >
    <Ionicons name={icon} size={22} color={color.indigo} />
  </Pressable>
)

/** The pencil, right of what it edits (its tip points to the bottom left). */
export const EditButton = ({ label, onPress }: { label: string; onPress: () => void }) => <IconButton icon="pencil" label={label} onPress={onPress} />

/** A section title with its action icon (add, upload) on the right. */
export const SectionHeader = ({ title, children, done }: { title: string; children?: React.ReactNode; done?: boolean }) => (
  <View style={styles.header}>
    <Text style={[styles.section, styles.headerTitle, done && { color: DONE_TEXT }]}>{title}</Text>
    {children}
  </View>
)

/** A row of SmallButtons that wraps on narrow phones. */
export const Actions = ({ children }: { children: React.ReactNode }) => <View style={styles.actions}>{children}</View>

export { styles as formStyles }

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  content: { padding: 12, gap: 8 },
  card: { backgroundColor: color.surface, borderWidth: 1, borderColor: color.divider, borderRadius: 6, padding: 12, gap: 6 },
  cardList: { borderWidth: 2, borderStyle: 'dashed', borderColor: color.indigo },
  cardDone: { backgroundColor: color.divider },
  section: { fontSize: 18, fontFamily: font.heading, color: color.ink },
  field: { gap: 4 },
  label: { fontSize: 14, fontWeight: '600', color: color.ink },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, gap: 12 },
  switchLabel: { flex: 1 },
  small: { minHeight: 44, paddingHorizontal: 14, borderRadius: 4, borderWidth: 1, borderColor: color.indigo, justifyContent: 'center' },
  smallLabel: { color: color.indigo, fontWeight: '600', fontSize: 15 },
  smallOff: { opacity: 0.5 },
  smallGrow: { flexGrow: 1, flexShrink: 1, flexBasis: '45%', minHeight: 52, paddingHorizontal: 6, alignItems: 'center' },
  smallGrowLabel: { textAlign: 'center', fontSize: 16 },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  headerTitle: { flex: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
})
