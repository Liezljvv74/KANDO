import { useRouter } from 'expo-router'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { SafeAreaView } from 'react-native-safe-area-context'

import { LinkText } from '@/components/auth-ui'
import { t } from '@/i18n'

export function FormScreen({ title, children, back = true }: { title: string; children: React.ReactNode; back?: boolean }) {
  const router = useRouter()
  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled">
        {back && <LinkText label={t('common.back')} onPress={() => router.back()} />}
        <Text style={styles.title}>{title}</Text>
        {children}
      </ScrollView>
    </SafeAreaView>
  )
}

export const Card = ({ children }: { children: React.ReactNode }) => <View style={styles.card}>{children}</View>

export const SectionTitle = ({ text }: { text: string }) => <Text style={styles.section}>{text}</Text>

export const SwitchRow = ({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) => (
  <View style={styles.switchRow}>
    <Text style={[styles.label, styles.switchLabel]}>{label}</Text>
    <Switch value={value} onValueChange={onChange} accessibilityLabel={label} trackColor={{ true: '#0E8A6B' }} />
  </View>
)

/** Small outlined button (list rows and the My profile actions); `busy` shows a spinner and blocks presses. */
export const SmallButton = ({
  label,
  onPress,
  accessibilityLabel,
  disabled,
  busy,
}: {
  label: string
  onPress: () => void
  accessibilityLabel?: string
  disabled?: boolean
  busy?: boolean
}) => (
  <Pressable
    onPress={onPress}
    disabled={disabled || busy}
    accessibilityRole="button"
    accessibilityLabel={accessibilityLabel ?? label}
    accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }}
    style={({ pressed }) => [styles.small, (disabled || busy) && styles.smallOff, pressed && styles.smallOff]}
  >
    {busy ? <ActivityIndicator color="#0E8A6B" /> : <Text style={styles.smallLabel}>{label}</Text>}
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
    {busy ? <ActivityIndicator color="#0E8A6B" /> : <Ionicons name={icon} size={22} color="#0E8A6B" />}
  </Pressable>
)

/** The pencil, right of what it edits (its tip points to the bottom left). */
export const EditButton = ({ label, onPress }: { label: string; onPress: () => void }) => <IconButton icon="pencil" label={label} onPress={onPress} />

/** A section title with its action icon (add, upload) on the right. */
export const SectionHeader = ({ title, children }: { title: string; children?: React.ReactNode }) => (
  <View style={styles.header}>
    <Text style={[styles.section, styles.headerTitle]}>{title}</Text>
    {children}
  </View>
)

/** A row of SmallButtons that wraps on narrow phones. */
export const Actions = ({ children }: { children: React.ReactNode }) => <View style={styles.actions}>{children}</View>

export { styles as formStyles }

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F2FBF8' },
  content: { padding: 12, gap: 8 },
  title: { fontSize: 22, fontWeight: '700', color: '#0E8A6B' },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 12, gap: 6 },
  section: { fontSize: 18, fontWeight: '700', color: '#14352E' },
  field: { gap: 4 },
  label: { fontSize: 14, fontWeight: '600', color: '#14352E' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, gap: 12 },
  switchLabel: { flex: 1 },
  small: { minHeight: 44, paddingHorizontal: 14, borderRadius: 22, borderWidth: 1, borderColor: '#0E8A6B', justifyContent: 'center' },
  smallLabel: { color: '#0E8A6B', fontWeight: '600', fontSize: 15 },
  smallOff: { opacity: 0.5 },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  headerTitle: { flex: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
})
