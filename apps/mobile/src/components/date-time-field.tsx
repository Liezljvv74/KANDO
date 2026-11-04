import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker'
import { useState } from 'react'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'

import { getLang, t } from '@/i18n'
import { suggestedWhen } from '@/lib/when-where'

/**
 * A date or a time of day chosen with the phone's own picker (a dialog on Android, a spinner under the field on iPhone, closed with
 * "Done") instead of typed text. `value` null shows `placeholder`; `minimumDate` / `maximumDate` bound what can be chosen; `initial` is where the picker opens when nothing is chosen yet (default: tomorrow morning, for a booking). The time is
 * shown in 24-hour form, like the picker.
 */
export function DateTimeField({
  label,
  placeholder,
  mode,
  value,
  onChange,
  minimumDate,
  maximumDate,
  initial,
  disabled,
}: {
  label: string
  placeholder: string
  mode: 'date' | 'time'
  value: Date | null
  onChange: (picked: Date) => void
  minimumDate?: Date
  maximumDate?: Date
  initial?: Date
  disabled?: boolean
}) {
  const [iosOpen, setIosOpen] = useState(false)
  const shown = value
    ? mode === 'date'
      ? value.toLocaleDateString(getLang(), { dateStyle: 'medium' })
      : value.toLocaleTimeString(getLang(), { hour: '2-digit', minute: '2-digit', hour12: false })
    : null
  const current = value ?? initial ?? suggestedWhen()

  function open() {
    if (disabled) return
    if (Platform.OS === 'android') return DateTimePickerAndroid.open({ value: current, mode, is24Hour: true, minimumDate, maximumDate, onValueChange: (_e, d) => onChange(d) })
    // the spinner shows a suggested value: opening it chooses that value, so accepting it needs no spin away and back
    if (!iosOpen && !value) onChange(current)
    setIosOpen((o) => !o)
  }

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={open} disabled={disabled} style={({ pressed }) => [styles.input, pressed && styles.pressed, disabled && styles.disabled]}>
        <Text style={shown ? styles.value : styles.placeholder}>{shown ?? placeholder}</Text>
      </Pressable>
      {Platform.OS === 'ios' && iosOpen && (
        <>
          <DateTimePicker value={current} mode={mode} display="spinner" is24Hour minimumDate={minimumDate} maximumDate={maximumDate} onValueChange={(_e, d) => onChange(d)} />
          <Pressable accessibilityRole="button" onPress={() => setIosOpen(false)} style={({ pressed }) => [styles.done, pressed && styles.pressed]}>
            <Text style={styles.doneLabel}>{t('common.done')}</Text>
          </Pressable>
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  field: { gap: 4 },
  label: { fontSize: 14, fontWeight: '600', color: '#1D1C4A' },
  input: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: '#7B7AB8', paddingHorizontal: 12, justifyContent: 'center', backgroundColor: '#fff' },
  value: { fontSize: 16, color: '#1D1C4A' },
  placeholder: { fontSize: 16, color: '#5E5D90' },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.5 },
  done: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  doneLabel: { color: '#34328A', fontSize: 16, fontWeight: '700' },
})
