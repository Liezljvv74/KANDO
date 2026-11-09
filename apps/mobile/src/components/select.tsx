import { useState } from 'react'
import { Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { SafeAreaView } from 'react-native-safe-area-context'

import { t } from '@/i18n'
import { matches } from '@/lib/match'
import { font } from '@/theme'

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
  const windowHeight = useWindowDimensions().height
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
        {/* A pixel height, not '70%': a percentage has nothing to measure against on the web, so the list grew past the screen and could not scroll. */}
        <SafeAreaView style={[styles.sheet, { maxHeight: windowHeight * 0.7 }]} edges={['bottom']}>
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
              placeholderTextColor="#5E5D90"
              accessibilityLabel={t('common.typeToSearch')}
              autoCorrect={false}
              style={styles.search}
            />
          )}
          {/* A ScrollView, not a FlatList: the lists are short (categories, countries), and a FlatList inside this web modal did not scroll. */}
          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled" accessibilityRole="radiogroup">
            {shown.length === 0 && <Text style={styles.empty}>{t('common.noMatches')}</Text>}
            {shown.map((item) => {
              const on = item.value === value
              return (
                <Pressable key={String(item.value)} onPress={() => pick(item.value)} accessibilityRole="radio" accessibilityState={{ checked: on }} style={[styles.option, on && styles.optionOn]}>
                  <Text style={[styles.optionLabel, on && styles.optionLabelOn]}>{item.label}</Text>
                  {on && (
                    <Text style={styles.check} importantForAccessibility="no">
                      ✓
                    </Text>
                  )}
                </Pressable>
              )
            })}
          </ScrollView>
        </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  field: { gap: 4 },
  label: { fontSize: 14, fontWeight: '600', color: '#1D1C4A' },
  input: {
    minHeight: 44,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#7B7AB8',
    paddingHorizontal: 12,
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  value: { flex: 1, fontSize: 16, color: '#1D1C4A' },
  placeholder: { color: '#5E5D90' },
  chevron: { fontSize: 16, color: '#34328A' },
  flex: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(20, 53, 46, 0.35)' },
  list: { flexShrink: 1 },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8 },
  sheetTitle: { fontSize: 18, fontFamily: font.heading, color: '#1D1C4A' },
  close: { minHeight: 44, justifyContent: 'center' },
  closeLabel: { fontSize: 15, fontWeight: '600', color: '#34328A' },
  option: { minHeight: 48, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#CFE6DC' },
  optionOn: { backgroundColor: '#CFE6DC' },
  optionLabel: { fontSize: 16, color: '#1D1C4A' },
  optionLabelOn: { fontWeight: '700', color: '#34328A' },
  check: { fontSize: 18, color: '#34328A' },
  search: { marginHorizontal: 16, marginBottom: 8, minHeight: 44, borderRadius: 4, borderWidth: 1, borderColor: '#7B7AB8', paddingHorizontal: 12, fontSize: 16, color: '#1D1C4A' },
  empty: { padding: 16, fontSize: 15, color: '#4F4E7D' },
})
