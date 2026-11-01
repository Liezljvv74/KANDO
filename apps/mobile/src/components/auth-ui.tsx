import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { SafeAreaView } from 'react-native-safe-area-context'

import { LanguageSwitch } from '@/components/language-switch'

/** How far above the keyboard the field being typed in stays (every scrolling form uses it, Android and iPhone alike). */
export const KEYBOARD_GAP = 24

export function AuthScreen({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAwareScrollView contentContainerStyle={styles.content} bottomOffset={KEYBOARD_GAP} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
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
      placeholderTextColor="#7A948D"
      style={[styles.input, error ? styles.inputError : null, style]}
    />
    <ErrorText text={error ?? null} />
  </View>
)

export const Button = ({ label, onPress, busy, disabled, danger }: { label: string; onPress: () => void; busy?: boolean; disabled?: boolean; danger?: boolean }) => (
  <Pressable
    onPress={onPress}
    disabled={busy || disabled}
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityState={{ busy: !!busy, disabled: !!(busy || disabled) }}
    // Dims while pressed, so a tap is visible.
    style={({ pressed }) => [styles.button, danger && styles.danger, (busy || disabled) && styles.busy, pressed && styles.pressed]}>
    {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonLabel}>{label}</Text>}
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
  root: { flex: 1, backgroundColor: '#F2FBF8' },
  content: { flexGrow: 1, padding: 16, justifyContent: 'center', gap: 12 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, gap: 12 },
  title: { fontSize: 22, fontWeight: '700', color: '#0E8A6B' },
  field: { gap: 4 },
  label: { fontSize: 14, fontWeight: '600', color: '#14352E' },
  input: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: '#BFE3D8', paddingHorizontal: 12, fontSize: 16, color: '#14352E', backgroundColor: '#fff' },
  inputError: { borderColor: '#B3261E' },
  hint: { fontSize: 13, color: '#4A6A62' },
  button: { minHeight: 44, borderRadius: 22, backgroundColor: '#0E8A6B', alignItems: 'center', justifyContent: 'center' },
  danger: { backgroundColor: '#B3261E' },
  busy: { opacity: 0.6 },
  buttonLabel: { color: '#fff', fontSize: 16, fontWeight: '700' },
  link: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  linkLabel: { color: '#0E8A6B', fontSize: 15, fontWeight: '600' },
  error: { color: '#B3261E', fontSize: 14 },
  info: { color: '#14352E', fontSize: 16, lineHeight: 22 },
})
