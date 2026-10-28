import { useEffect, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'

import type { MyProfile } from '@kando/contract'

import { ApiError } from '@/api/client'
import { ensureDraft, getMyProfile, saveMyProfile } from '@/api/my-profile'
import { ErrorText, Field } from '@/components/auth-ui'
import { Card, FormScreen, SmallButton, SwitchRow } from '@/components/form-ui'
import { Select } from '@/components/select'
import { ErrorRetry, Loading } from '@/components/state-view'
import { useFieldSave } from '@/hooks/use-field-save'
import { useLoad } from '@/hooks/use-load'
import { errorText, t, useLang } from '@/i18n'
import { compulsory } from '@/lib/compulsory'
import { registerPendingTags } from '@/lib/pending-tags'
import { MAX_SKILLS, MAX_SKILL_LENGTH, radiusBody, typedTag, validRadius } from '@/lib/profile-form'
import { TagInput } from './tag-input'

const splitLines = (s: string | null | undefined) => [...new Set((s ?? '').split('\n').map((x) => x.trim()).filter(Boolean))]
/** The server keeps strengths as one text of at most 1000 characters. */
const MAX_STRENGTHS_TEXT = 1000

const loadProfile = async () => (await getMyProfile()) ?? (await ensureDraft())

/** The "About you" screen: every field saves on its own. */
export default function AboutScreen() {
  useLang()
  const { data, error, retry } = useLoad(loadProfile)
  return <FormScreen title={t('setup.aboutYou')}>{data ? <AboutForm initial={data} /> : error ? <ErrorRetry code={error} onRetry={retry} /> : <Loading />}</FormScreen>
}

/**
 * One field = one useFieldSave = one request; a typed value is never taken from a response, so a slow save cannot revert
 * what the user typed since. `initial` is read once: the form is mounted after the first load and keeps its own values.
 */
function AboutForm({ initial }: { initial: MyProfile }) {
  const [code, setCode] = useState<Record<string, string>>({})
  // Binds a field to the profile: `toBody` makes the one-field PUT body, null skips the request.
  function useField<V>(key: string, initialValue: V, toBody: (v: V) => object | null) {
    return useFieldSave<V>(initialValue, async (v) => {
      const body = toBody(v)
      if (!body) return
      try {
        await saveMyProfile(body)
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

  // Typed but not yet added tags are added and saved when the screen is left or Publish is pressed (see lib/pending-tags).
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
      <Select
        {...compulsory('providerType')}
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
          <Field {...compulsory('businessName')} value={businessName.value} onChangeText={businessName.setValue} onBlur={businessName.flush} maxLength={120} />
          {problem('businessName', businessName)}
          <Field {...compulsory('impressum')} value={impressum.value} onChangeText={impressum.setValue} onBlur={impressum.flush} multiline maxLength={1000} style={styles.multi} />
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
        {...compulsory('skills')}
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
      <Field {...compulsory('experience')} hint={t('f.experienceHint')} value={experience.value} onChangeText={experience.setValue} onBlur={experience.flush} multiline maxLength={500} style={styles.multi} />
      {problem('experience', experience)}
      <Field
        {...compulsory('postcode')}
        value={postcode.value}
        onChangeText={postcode.setValue}
        onBlur={postcode.flush}
        error={unknownPostcode ? errorText('Unknown postcode') : null}
      />
      {unknownPostcode ? null : problem('basePostcode', postcode)}
      <Field
        {...compulsory('radius')}
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
