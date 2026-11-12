import { useLocalSearchParams } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { AppState, StyleSheet, View } from 'react-native'

import type { MyProfile } from '@kando/contract'

import { ensureDraft, getMyProfile } from '@/api/my-profile'
import { ErrorText, Field } from '@/components/auth-ui'
import { Card, FormScreen, SmallButton, SwitchRow } from '@/components/form-ui'
import { Select } from '@/components/select'
import { DoneBar } from '@/components/done-bar'
import { ErrorRetry, Loading } from '@/components/state-view'
import { useDone } from '@/hooks/use-done'
import { useFieldSave } from '@/hooks/use-field-save'
import { useLoad } from '@/hooks/use-load'
import { useSession } from '@/hooks/use-session'
import { errorText, t, useLang } from '@/i18n'
import { compulsory } from '@/lib/compulsory'
import { usePendingEntry } from '@/lib/pending-saves'
import { flushPendingTags, registerPendingTags } from '@/lib/pending-tags'
import { aboutMissing } from '@/lib/required-fields'
import { MAX_SKILLS, MAX_SKILL_LENGTH, radiusBody, typedTag, validRadius } from '@/lib/profile-form'
import { TagInput } from './tag-input'

const splitLines = (s: string | null | undefined) => [...new Set((s ?? '').split('\n').map((x) => x.trim()).filter(Boolean))]
/** The server keeps strengths as one text of at most 1000 characters. */
const MAX_STRENGTHS_TEXT = 1000

const noSave = async () => {} // every About you field is sent through the pending-saves store
const loadProfile = async () => (await getMyProfile()) ?? (await ensureDraft())

/** The "About you" screen: every field saves on its own. `?field=` (from a Live checklist row) puts the cursor in that field. */
export default function AboutScreen() {
  useLang()
  const { field } = useLocalSearchParams<{ field?: string }>()
  const { data, error, retry } = useLoad(loadProfile)
  if (data) return <AboutForm initial={data} focus={field} />
  return <FormScreen title={t('setup.aboutYou')}>{error ? <ErrorRetry code={error} onRetry={retry} /> : <Loading />}</FormScreen>
}

/**
 * One field = one useFieldSave = one request; a typed value is never taken from a response, so a slow save cannot revert
 * what the user typed since. `initial` is read once: the form is mounted after the first load and keeps its own values.
 */
function AboutForm({ initial, focus }: { initial: MyProfile; focus?: string }) {
  const accountId = useSession().user?.id ?? ''
  // Binds a field to the profile: `toBody` makes the one-field PUT body (null removes the stored change). The value is kept
  // on the phone from the first keystroke and sent by the 'about' sender; a reopened screen starts from a stored value.
  function useField<V>(key: string, initialValue: V, toBody: (v: V) => object | null, fromBody: (body: Record<string, never>) => V = (b) => b[key] as V) {
    const storeKey = `about:${key}`
    const pending = usePendingEntry(storeKey, accountId)
    return useFieldSave<V>(pending ? fromBody(pending.body as Record<string, never>) : initialValue, noSave, 600, {
      key: storeKey,
      kind: 'about',
      accountId,
      route: `/my-profile/about?field=${key}`,
      field: key,
      toBody,
    })
  }

  const type = useField<'individual' | 'business' | null>('providerType', initial.providerType ?? null, (v) => (v ? { providerType: v } : null))
  const businessName = useField('businessName', initial.businessName ?? '', (v) => ({ businessName: v.trim() }))
  const impressum = useField('impressum', initial.impressum ?? '', (v) => ({ impressum: v.trim() }))
  const bio = useField('bio', initial.bio ?? '', (v) => ({ bio: v.trim() }))
  const strengths = useField('strengths', splitLines(initial.strengths), (v) => ({ strengths: v.join('\n') }), (b) => splitLines(b.strengths))
  const skills = useField('skills', initial.skills ?? [], (v) => ({ skills: v }))
  const experience = useField('experience', initial.experience ?? '', (v) => ({ experience: v.trim() }))
  const postcode = useField('basePostcode', initial.basePostcode ?? '', (v) => ({ basePostcode: v.trim() }))
  const radius = useField('serviceRadiusKm', String(initial.serviceRadiusKm ?? 25), radiusBody, (b) => String(b.serviceRadiusKm))
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
    const sub = AppState.addEventListener('change', (s) => s !== 'active' && void flushTyped()) // the app goes to the background
    return () => {
      off()
      sub.remove()
      void flushTyped() // the card is going away
    }
    // runs once: reads the latest values through `typed`, the setters are stable
  }, [])

  // A failed save keeps the value and says why, with a retry.
  const problem = (f: { status: string; errorCode: string | null; retry: () => void }) =>
    f.status === 'error' && f.errorCode ? (
      <View>
        <ErrorText text={errorText(f.errorCode)} />
        <SmallButton label={t('common.retry')} onPress={f.retry} />
      </View>
    ) : null
  // Done: typed-but-not-added tags are added, then every unsaved field is sent (never awaited).
  const done = useDone({
    isProvider: true,
    step: 'about',
    missing: () =>
      aboutMissing({
        providerType: type.value,
        businessName: businessName.value,
        impressum: impressum.value,
        // typed text counts only when it would really be added (not too long, not a duplicate, not over the maximum)
        strengths: strengths.value.length ? strengths.value : (typedTag(strengths.value, strengthText, MAX_SKILLS, MAX_SKILL_LENGTH, MAX_STRENGTHS_TEXT).list ?? []),
        skills: skills.value.length ? skills.value : (typedTag(skills.value, skillText, MAX_SKILLS, MAX_SKILL_LENGTH, Infinity).list ?? []),
        postcode: postcode.value,
        radiusValid: validRadius(radius.value),
      }),
    flush: () => Promise.all([flushPendingTags(), ...[type, businessName, impressum, bio, strengths, skills, experience, postcode, radius, remote].map((f) => f.flush())]),
  })
  const unknownPostcode = postcode.status === 'error' && postcode.errorCode === 'Unknown postcode'

  return (
    <FormScreen title={t('setup.aboutYou')} footer={<DoneBar onPress={done.onDone} message={done.message} />}>
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
      {problem(type)}
      {type.value === 'business' && (
        <>
          <Field {...compulsory('businessName')} autoFocus={focus === 'businessName'} value={businessName.value} onChangeText={businessName.setValue} onBlur={businessName.flush} maxLength={120} />
          {problem(businessName)}
          <Field {...compulsory('impressum')} autoFocus={focus === 'impressum'} value={impressum.value} onChangeText={impressum.setValue} onBlur={impressum.flush} multiline maxLength={1000} style={styles.multi} />
          {problem(impressum)}
        </>
      )}
      <Field label={t('f.bio')} value={bio.value} onChangeText={bio.setValue} onBlur={bio.flush} multiline maxLength={2000} style={styles.multi} />
      {problem(bio)}
      <TagInput
        {...compulsory('strengths')}
        autoFocus={focus === 'strengths'}
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
      {problem(strengths)}
      <TagInput
        {...compulsory('skills')}
        autoFocus={focus === 'skills'}
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
      {problem(skills)}
      <Field label={t('provider.experience')} placeholder={t('ph.experience')} hint={t('f.experienceHint')} value={experience.value} onChangeText={experience.setValue} onBlur={experience.flush} multiline maxLength={500} style={styles.multi} />
      {problem(experience)}
      <Field
        {...compulsory('postcode')}
        autoFocus={focus === 'basePostcode' || focus === 'postcode'}
        value={postcode.value}
        onChangeText={postcode.setValue}
        onBlur={postcode.flush}
        error={unknownPostcode ? errorText('Unknown postcode') : null}
      />
      {unknownPostcode ? null : problem(postcode)}
      <Field
        {...compulsory('radius')}
        autoFocus={focus === 'serviceRadiusKm' || focus === 'radius'}
        value={radius.value}
        onChangeText={radius.setValue}
        onBlur={radius.flush}
        keyboardType="number-pad"
        maxLength={3}
        error={validRadius(radius.value) ? null : t('f.radiusError')}
      />
      {problem(radius)}
      <SwitchRow
        label={t('f.remote')}
        value={remote.value}
        onChange={(v) => {
          remote.setValue(v)
          remote.flush()
        }}
      />
      {problem(remote)}
    </Card>
    </FormScreen>
  )
}

const styles = StyleSheet.create({
  multi: { minHeight: 72, paddingTop: 10, textAlignVertical: 'top' },
})
