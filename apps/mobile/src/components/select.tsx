import { useState } from 'react'
import { FlatList, Keyboard, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { SafeAreaView } from 'react-native-safe-area-context'

import { t } from '@/i18n'
import { matches } from '@/lib/match'

/** A dropdown: a field showing the chosen option; tapping it opens a scrollable list of options. */
export function Select<T extends string | number>({
  label,
  options,
  value,
  onChange,
  placeholder = t('common.choose'),
  hint,
  hideLabel,
  searchable,
}: {
  label: string
  options: { value: T; label: string }[]
  value: T | null
  onChange: (v: T) => void
  placeholder?: string
  hint?: string
  /** No visible label (the placeholder says it); screen readers and the list's title still use `label`. */
  hideLabel?: boolean
  /** A search field above the list: typing narrows the options; empty shows all. */
  searchable?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const selected = options.find((o) => o.value === value)
  const shown = searchable ? options.filter((o) => matches(o.label, query)) : options
  const close = () => {
    setOpen(false)
    setQuery('')
  }
  const pick = (v: T) => {
    onChange(v)
    close()
  }

  return (
    <View style={styles.field}>
      {!hideLabel && <Text style={styles.label}>{label}</Text>}
      <Pressable
        onPress={() => {
          // A choice needs no typing: close the keyboard left open by the previous text field.
          Keyboard.dismiss()
          setOpen(true)
        }}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected?.label ?? placeholder}`}
        accessibilityHint={hint}
        accessibilityState={{ expanded: open }}
        style={styles.input}
      >
        <Text style={[styles.value, !selected && styles.placeholder]} numberOfLines={1}>
          {selected?.label ?? placeholder}
        </Text>
        <Text style={styles.chevron} importantForAccessibility="no">
          ▾
        </Text>
      </Pressable>

      {/* A modal is its own window: translucent bars let the keyboard view measure it on Android; the sheet then rises above the keyboard. */}
      <Modal visible={open} animationType="slide" transparent statusBarTranslucent navigationBarTranslucent onRequestClose={close}>
        <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <Pressable style={styles.backdrop} onPress={close} accessibilityLabel={t('common.close')} accessibilityRole="button" />
        <SafeAreaView style={styles.sheet} edges={['bottom']}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle} accessibilityRole="header">
              {label}
            </Text>
            <Pressable onPress={close} accessibilityRole="button" hitSlop={8} style={styles.close}>
              <Text style={styles.closeLabel}>{t('common.close')}</Text>
            </Pressable>
          </View>
          {/* Not focused on open: the keyboard only comes up when the user taps here to type. */}
          {searchable && (
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t('common.typeToSearch')}
              placeholderTextColor="#7A948D"
              accessibilityLabel={t('common.typeToSearch')}
              autoCorrect={false}
              style={styles.search}
            />
          )}
          <FlatList
            data={shown}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={<Text style={styles.empty}>{t('common.noMatches')}</Text>}
            keyExtractor={(o) => String(o.value)}
            accessibilityRole="radiogroup"
            renderItem={({ item }) => {
              const on = item.value === value
              return (
                <Pressable onPress={() => pick(item.value)} accessibilityRole="radio" accessibilityState={{ checked: on }} style={[styles.option, on && styles.optionOn]}>
                  <Text style={[styles.optionLabel, on && styles.optionLabelOn]}>{item.label}</Text>
                  {on && (
                    <Text style={styles.check} importantForAccessibility="no">
                      ✓
                    </Text>
                  )}
                </Pressable>
              )
            }}
          />
        </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  field: { gap: 4 },
  label: { fontSize: 14, fontWeight: '600', color: '#14352E' },
  input: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#BFE3D8',
    paddingHorizontal: 12,
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  value: { flex: 1, fontSize: 16, color: '#14352E' },
  placeholder: { color: '#7A948D' },
  chevron: { fontSize: 16, color: '#0E8A6B' },
  flex: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(20, 53, 46, 0.35)' },
  sheet: { maxHeight: '70%', backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8 },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: '#14352E' },
  close: { minHeight: 44, justifyContent: 'center' },
  closeLabel: { fontSize: 15, fontWeight: '600', color: '#0E8A6B' },
  option: { minHeight: 48, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#E1F4EE' },
  optionOn: { backgroundColor: '#E1F4EE' },
  optionLabel: { fontSize: 16, color: '#14352E' },
  optionLabelOn: { fontWeight: '700', color: '#0E8A6B' },
  check: { fontSize: 18, color: '#0E8A6B' },
  search: { marginHorizontal: 16, marginBottom: 8, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: '#BFE3D8', paddingHorizontal: 12, fontSize: 16, color: '#14352E' },
  empty: { padding: 16, fontSize: 15, color: '#5C7A72' },
})
