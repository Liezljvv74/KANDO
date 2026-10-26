import { Pressable, StyleSheet, Text, View } from 'react-native'

import { Field } from '@/components/auth-ui'
import { Actions, SmallButton } from '@/components/form-ui'
import { t } from '@/i18n'
import { withItem } from '@/lib/profile-form'

/**
 * A short list (skills, strengths): type, then "Add" or the keyboard's Done; each tag shows as a chip, tap to remove.
 * The typed text lives in the parent so Save can include a tag that was typed but not added yet.
 */
export function TagInput({
  label,
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
    if (__DEV__) console.log(`add ${JSON.stringify(text)} to ${JSON.stringify(items)}`)
    onItems(withItem(items, text))
    onText('')
  }
  return (
    <View style={styles.root}>
      <Field
        label={`${label} (${items.length}/${max})`}
        value={text}
        onChangeText={onText}
        maxLength={maxLength}
        onSubmitEditing={add}
        submitBehavior="submit"
        returnKeyType="done"
        error={error}
      />
      {items.length < max && (
        <Actions>
          <SmallButton label={addLabel} onPress={add} disabled={!text.trim()} />
        </Actions>
      )}
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
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 36, paddingHorizontal: 12, borderRadius: 18, backgroundColor: '#E1F4EE', justifyContent: 'center' },
  chipText: { color: '#14352E', fontSize: 14 },
})
