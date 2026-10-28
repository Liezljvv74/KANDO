import { useEffect, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'

import type { MyProfile } from '@kando/contract'

import { ApiError } from '@/api/client'
import { saveMyProfile } from '@/api/my-profile'
import { ErrorText, Field } from '@/components/auth-ui'
import { Card, SectionHeader, SmallButton, SwitchRow } from '@/components/form-ui'
import { Select } from '@/components/select'
import { useFieldSave } from '@/hooks/use-field-save'
import { errorText, t } from '@/i18n'
import { registerPendingTags } from '@/lib/pending-tags'
import { MAX_SKILLS, MAX_SKILL_LENGTH, radiusBody, typedTag, validRadius } from '@/lib/profile-form'
import { TagInput } from '../my-profile/tag-input'

const splitLines = (s: string | null | undefined) => [...new Set((s ?? '').split('\n').map((x) => x.trim()).filter(Boolean))]
/** The server keeps strengths as one text of at most 1000 characters. */
const MAX_STRENGTHS_TEXT = 1000

/**
 * One field = one useFieldSave = one request. Every response replaces the held profile (`onSaved`, for the Publish bar);
 * a typed value is never taken from a response, so a slow save cannot revert what the user typed since.
 * `initial` is read once: the card is mounted after the first load and keeps its own values from then on.
 */
export function AboutCard({ initial, onSaved, stamp }: { initial: MyProfile; onSaved: (p: MyProfile) => void; stamp: () => () => boolean }) {
  const [code, setCode] = useState<Record<string, string>>({})
  // Binds a field to the profile: `toBody` makes the one-field PUT body, null skips the request.
  function useField<V>(key: string, initialValue: V, toBody: (v: V) => object | null) {
    return useFieldSave<V>(initialValue, async (v) => {
      const body = toBody(v)
      if (!body) return
      try {
        const fresh = stamp() // an answer older than one already applied must not replace the held profile
        const saved = await saveMyProfile(body)
        if (fresh()) onSaved(saved)
        setCode((c) => (c[key] ? { ...c, [key]: '' } : c))
      } catch (e) {
        setCode((c) => ({ ...c, [key]: e instanceof ApiError ? e.code : 'network' }))
        throw e
      }
    })
  }

  const type = useField<'individual' | 'business' | null>('providerType', initial.providerType ?? null, (v) => (v ? { providerType: v } : null))
  const businessName = useField('businessName', initial.businessName ?? '', (v) => ({ businessName: v.trim() }))
  const impressum = useField('impressum', initial.impressum ?? '', (v) => ({ impressum: v.trim() }))
  const bio = useField('bio', initial.bio ?? '', (v) => ({ bio: v.trim() }))
  const strengths = useField('strengths', splitLines(initial.strengths), (v) => ({ strengths: v.join('\n') }))
  const skills = useField('skills', initial.skills ?? [], (v) => ({ skills: v }))
  const experience = useField('experience', initial.experience ?? '', (v) => ({ experience: v.trim() }))
  const postcode = useField('basePostcode', initial.basePostcode ?? '', (v) => ({ basePostcode: v.trim() }))
  const radius = useField('serviceRadiusKm', String(initial.serviceRadiusKm ?? 25), radiusBody)
  const remote = useField('worksRemotely', !!initial.worksRemotely, (v) => ({ worksRemotely: v }))
  const [skillText, setSkillText] = useState('')
  const [strengthText, setStrengthText] = useState('')
  const [strengthsTooLong, setStrengthsTooLong] = useState(false)

  // Typed but not yet added tags are added and saved when the page is left or Publish is pressed (see lib/pending-tags).
  const typed = useRef({ skills: skills.value, skillText, strengths: strengths.value, strengthText })
  typed.current = { skills: skills.value, skillText, strengths: strengths.value, strengthText }
  useEffect(() => {
    const flushTyped = () => {
      const now = typed.current
      typed.current = { ...now, skillText: '', strengthText: '' } // sent once: the focus cleanup and the unmount cleanup both call this
      const jobs: Promise<void>[] = []
      const addedSkill = typedTag(now.skills, now.skillText, MAX_SKILLS, MAX_SKILL_LENGTH, Infinity)
      if (addedSkill.list) {
        skills.setValue(addedSkill.list)
        setSkillText('')
        jobs.push(skills.flush())
      }
      const addedStrength = typedTag(now.strengths, now.strengthText, MAX_SKILLS, MAX_SKILL_LENGTH, MAX_STRENGTHS_TEXT)
      if (addedStrength.list) {
        strengths.setValue(addedStrength.list)
        setStrengthText('')
        jobs.push(strengths.flush())
      }
      if (addedStrength.tooLong) setStrengthsTooLong(true) // the text stays in the field with the same error as TagInput
      return Promise.all(jobs)
    }
    const off = registerPendingTags(flushTyped)
    return () => {
      off()
      void flushTyped() // the card is going away
    }
    // runs once: reads the latest values through `typed`, the setters are stable
  }, [])

  // A failed save keeps the value and says why, with a retry.
  const problem = (key: string, f: { status: string; retry: () => void }) =>
    f.status === 'error' && code[key] ? (
      <View>
        <ErrorText text={errorText(code[key])} />
        <SmallButton label={t('common.retry')} onPress={f.retry} />
      </View>
    ) : null
  const unknownPostcode = postcode.status === 'error' && code.basePostcode === 'Unknown postcode'

  return (
    <Card>
      <SectionHeader title={t('setup.aboutYou')} />
      <Select
        label={t('f.type')}
        value={type.value}
        onChange={(v) => {
          type.setValue(v)
          type.flush()
        }}
        options={[
          { value: 'individual', label: t('f.individual') },
          { value: 'business', label: t('f.business') },
        ]}
      />
      {problem('providerType', type)}
      {type.value === 'business' && (
        <>
          <Field label={t('f.businessName')} value={businessName.value} onChangeText={businessName.setValue} onBlur={businessName.flush} maxLength={120} />
          {problem('businessName', businessName)}
          <Field label={t('provider.impressum')} value={impressum.value} onChangeText={impressum.setValue} onBlur={impressum.flush} multiline maxLength={1000} style={styles.multi} />
          {problem('impressum', impressum)}
        </>
      )}
      <Field label={t('f.bio')} value={bio.value} onChangeText={bio.setValue} onBlur={bio.flush} multiline maxLength={2000} style={styles.multi} />
      {problem('bio', bio)}
      <TagInput
        label={t('provider.strengths')}
        items={strengths.value}
        onItems={(v) => {
          // Stop adding once the joined text would pass the server's limit (removing is always fine).
          const tooLong = v.length > strengths.value.length && v.join('\n').length > MAX_STRENGTHS_TEXT
          setStrengthsTooLong(tooLong)
          if (tooLong) return
          strengths.setValue(v)
          strengths.flush()
        }}
        text={strengthText}
        onText={setStrengthText}
        max={MAX_SKILLS}
        maxLength={MAX_SKILL_LENGTH}
        addLabel={t('f.strengthAdd')}
        error={strengthsTooLong ? t('f.strengthsError') : null}
      />
      {problem('strengths', strengths)}
      <TagInput
        label={t('provider.skills')}
        items={skills.value}
        onItems={(v) => {
          skills.setValue(v)
          skills.flush()
        }}
        text={skillText}
        onText={setSkillText}
        max={MAX_SKILLS}
        maxLength={MAX_SKILL_LENGTH}
        addLabel={t('f.skillAdd')}
      />
      {problem('skills', skills)}
      <Field label={t('provider.experience')} hint={t('f.experienceHint')} value={experience.value} onChangeText={experience.setValue} onBlur={experience.flush} multiline maxLength={500} style={styles.multi} />
      {problem('experience', experience)}
      <Field
        label={t('search.postcode')}
        value={postcode.value}
        onChangeText={postcode.setValue}
        onBlur={postcode.flush}
        error={unknownPostcode ? errorText('Unknown postcode') : null}
      />
      {unknownPostcode ? null : problem('basePostcode', postcode)}
      <Field
        label={t('f.radius')}
        value={radius.value}
        onChangeText={radius.setValue}
        onBlur={radius.flush}
        keyboardType="number-pad"
        maxLength={3}
        error={validRadius(radius.value) ? null : t('f.radiusError')}
      />
      {problem('serviceRadiusKm', radius)}
      <SwitchRow
        label={t('f.remote')}
        value={remote.value}
        onChange={(v) => {
          remote.setValue(v)
          remote.flush()
        }}
      />
      {problem('worksRemotely', remote)}
    </Card>
  )
}

const styles = StyleSheet.create({
  multi: { minHeight: 72, paddingTop: 10, textAlignVertical: 'top' },
})
