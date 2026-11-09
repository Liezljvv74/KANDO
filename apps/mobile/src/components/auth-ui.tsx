import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { SafeAreaView } from 'react-native-safe-area-context'

import { LanguageSwitch } from '@/components/language-switch'
import { ScreenBanner } from '@/components/screen-banner'
import { color, font } from '@/theme'

/** How far above the keyboard the field being typed in stays (every scrolling form uses it, Android and iPhone alike). */
export const KEYBOARD_GAP = 24

export function AuthScreen({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <SafeAreaView style={styles.root} edges={['left', 'right', 'bottom']}>
      <ScreenBanner title={title} />
      <KeyboardAwareScrollView contentContainerStyle={styles.content} bottomOffset={KEYBOARD_GAP} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          {children}
        </View>
        <LanguageSwitch />
      </KeyboardAwareScrollView>
    </SafeAreaView>
  )
}

/** `hint` shows under the label and is read as the accessibility hint. */
export const Field = ({ label, error, style, hint, ...props }: TextInputProps & { label: string; error?: string | null; hint?: string }) => (
  <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    {!!hint && <Text style={styles.hint}>{hint}</Text>}
    <TextInput
      {...props}
      accessibilityLabel={label}
      accessibilityHint={hint}
      placeholderTextColor={color.placeholder}
      style={[styles.input, error ? styles.inputError : null, style]}
    />
    <ErrorText text={error ?? null} />
  </View>
)

/** `a11yLabel` is read instead of `label` when several buttons share one text (each says what it acts on); `selected` marks the chosen option of a switch. */
export const Button = ({ label, onPress, busy, disabled, danger, a11yLabel, selected }: { label: string; onPress: () => void; busy?: boolean; disabled?: boolean; danger?: boolean; a11yLabel?: string; selected?: boolean }) => (
  <Pressable
    onPress={onPress}
    disabled={busy || disabled}
    accessibilityRole="button"
    accessibilityLabel={a11yLabel ?? label}
    accessibilityState={{ busy: !!busy, disabled: !!(busy || disabled), selected }}
    // Dims while pressed, so a tap is visible.
    style={({ pressed }) => [styles.button, danger && styles.danger, (busy || disabled) && styles.busy, pressed && styles.pressed]}>
    {busy ? <ActivityIndicator color={danger ? color.surface : color.ink} /> : <Text style={[styles.buttonLabel, danger && styles.dangerLabel]}>{label}</Text>}
  </Pressable>
)

export const LinkText = ({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) => (
  <Pressable onPress={onPress} disabled={disabled} accessibilityRole="link" accessibilityState={{ disabled: !!disabled }} style={[styles.link, disabled && styles.busy]}>
    <Text style={styles.linkLabel}>{label}</Text>
  </Pressable>
)

export const ErrorText = ({ text }: { text: string | null }) =>
  text ? (
    <Text style={styles.error} accessibilityRole="alert">
      {text}
    </Text>
  ) : null

export const Info = ({ text }: { text: string }) => <Text style={styles.info}>{text}</Text>

const styles = StyleSheet.create({
  pressed: { opacity: 0.6 },
  root: { flex: 1, backgroundColor: color.bg },
  content: { flexGrow: 1, padding: 16, justifyContent: 'center', gap: 12 },
  card: { backgroundColor: color.surface, borderWidth: 1, borderColor: color.divider, borderRadius: 6, padding: 16, gap: 12 },
  title: { fontSize: 24, fontFamily: font.heading, color: color.indigo },
  field: { gap: 4 },
  label: { fontSize: 14, fontWeight: '600', color: color.ink },
  input: { minHeight: 44, borderRadius: 4, borderWidth: 1, borderColor: color.border, paddingHorizontal: 12, fontSize: 16, color: color.ink, backgroundColor: color.surface },
  inputError: { borderColor: color.danger },
  hint: { fontSize: 13, color: color.inkMuted },
  button: { minHeight: 48, borderRadius: 4, backgroundColor: color.teal, alignItems: 'center', justifyContent: 'center' },
  danger: { backgroundColor: color.danger },
  busy: { opacity: 0.6 },
  buttonLabel: { color: color.ink, fontSize: 16, fontWeight: '700' },
  dangerLabel: { color: color.surface },
  link: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  linkLabel: { color: color.indigo, fontSize: 15, fontWeight: '600' },
  error: { color: color.danger, fontSize: 14 },
  info: { color: color.ink, fontSize: 16, lineHeight: 22 },
})
