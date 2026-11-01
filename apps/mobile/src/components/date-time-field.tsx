import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker'
import { useState } from 'react'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'

import { getLang } from '@/i18n'
import { suggestedWhen } from '@/lib/when-where'

/**
 * A date or a time of day chosen with the phone's own picker (a dialog on Android, a spinner under the field on iPhone) instead of
 * typed text. `value` null shows `placeholder`; `minimumDate` is the earliest day that can be chosen.
 */
export function DateTimeField({
  label,
  placeholder,
  mode,
  value,
  onChange,
  minimumDate,
  disabled,
}: {
  label: string
  placeholder: string
  mode: 'date' | 'time'
  value: Date | null
  onChange: (picked: Date) => void
  minimumDate?: Date
  disabled?: boolean
}) {
  const [iosOpen, setIosOpen] = useState(false)
  const shown = value
    ? mode === 'date'
      ? value.toLocaleDateString(getLang(), { dateStyle: 'medium' })
      : value.toLocaleTimeString(getLang(), { timeStyle: 'short' })
    : null
  const current = value ?? suggestedWhen()

  function open() {
    if (disabled) return
    if (Platform.OS === 'android') DateTimePickerAndroid.open({ value: current, mode, is24Hour: true, minimumDate, onValueChange: (_e, d) => onChange(d) })
    else setIosOpen((o) => !o)
  }

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={open} disabled={disabled} style={({ pressed }) => [styles.input, pressed && styles.pressed, disabled && styles.disabled]}>
        <Text style={shown ? styles.value : styles.placeholder}>{shown ?? placeholder}</Text>
      </Pressable>
      {Platform.OS === 'ios' && iosOpen && <DateTimePicker value={current} mode={mode} display="spinner" is24Hour minimumDate={minimumDate} onValueChange={(_e, d) => onChange(d)} />}
    </View>
  )
}

const styles = StyleSheet.create({
  field: { gap: 4 },
  label: { fontSize: 14, fontWeight: '600', color: '#14352E' },
  input: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: '#BFE3D8', paddingHorizontal: 12, justifyContent: 'center', backgroundColor: '#fff' },
  value: { fontSize: 16, color: '#14352E' },
  placeholder: { fontSize: 16, color: '#7A9890' },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.5 },
})
