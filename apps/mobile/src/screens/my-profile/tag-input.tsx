import { Pressable, StyleSheet, Text, View } from 'react-native'

import { Field } from '@/components/auth-ui'
import { IconButton } from '@/components/form-ui'
import { t } from '@/i18n'
import { withItem } from '@/lib/profile-form'

/**
 * A short list (skills, strengths): type, then "+" or the keyboard's Done; each tag shows as a chip, tap to remove.
 * The typed text lives in the parent; leaving the field adds a tag that was typed but not added yet.
 */
export function TagInput({
  label,
  placeholder,
  items,
  onItems,
  text,
  onText,
  max,
  maxLength,
  addLabel,
  error,
}: {
  label: string
  placeholder?: string
  items: string[]
  onItems: (items: string[]) => void
  text: string
  onText: (text: string) => void
  max: number
  maxLength: number
  addLabel: string
  error?: string | null
}) {
  const add = () => {
    onItems(withItem(items, text))
    onText('')
  }
  return (
    <View style={styles.root}>
      <View style={styles.entry}>
        <View style={styles.entryField}>
          <Field
            label={`${label} (${items.length}/${max})`}
            placeholder={placeholder}
            value={text}
            onChangeText={onText}
            maxLength={maxLength}
            onSubmitEditing={add}
            submitBehavior="submit"
            onBlur={() => text.trim() && add()}
            returnKeyType="done"
            error={error}
          />
        </View>
        {items.length < max && (
          <View style={error ? styles.addWithError : styles.add}>
            <IconButton icon="add-circle-outline" label={addLabel} onPress={add} disabled={!text.trim()} />
          </View>
        )}
      </View>
      <View style={styles.chips}>
        {items.map((s) => (
          <Pressable key={s} onPress={() => onItems(items.filter((x) => x !== s))} accessibilityRole="button" accessibilityLabel={`${s}, ${t('common.delete')}`} style={styles.chip}>
            <Text style={styles.chipText}>{s}  ×</Text>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { gap: 10 },
  entry: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  entryField: { flex: 1 },
  add: { paddingBottom: 2 },
  addWithError: { paddingBottom: 26 }, // keeps the + level with the field when its error shows below it
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 36, paddingHorizontal: 12, borderRadius: 18, backgroundColor: '#E1F4EE', justifyContent: 'center' },
  chipText: { color: '#14352E', fontSize: 14 },
})
