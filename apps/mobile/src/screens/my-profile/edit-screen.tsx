import { useRouter } from 'expo-router'
import { useState } from 'react'
import { StyleSheet } from 'react-native'

import { ApiError } from '@/api/client'
import { getMyProfile, saveMyProfile } from '@/api/my-profile'
import { Button, ErrorText, Field } from '@/components/auth-ui'
import { Card, FormScreen, SwitchRow } from '@/components/form-ui'
import { Select } from '@/components/select'
import { ErrorRetry, Loading } from '@/components/state-view'
import { useLoad } from '@/hooks/use-load'
import { TagInput } from './tag-input'
import { useSession } from '@/hooks/use-session'
import { errorText, t, useLang } from '@/i18n'
import { MAX_SKILLS, MAX_SKILL_LENGTH, nameChange, profileBody, profileFromDoc, needsFormError, serverFieldErrors, withItem, validateProfile, type Errors, type ProfileForm } from '@/lib/profile-form'

export default function EditProfileScreen() {
  useLang()
  const { done, data, error, retry } = useLoad(getMyProfile)
  const { user } = useSession()
  return (
    <FormScreen title={t('tab.myProfile')}>
      {!done ? error ? <ErrorRetry code={error} onRetry={retry} /> : <Loading /> : <ProfileFormView initial={profileFromDoc(data ?? null, user?.name ?? '')} />}
    </FormScreen>
  )
}

function ProfileFormView({ initial }: { initial: ProfileForm }) {
  const router = useRouter()
  const { user, updateName } = useSession()
  const [f, setF] = useState(initial)
  const [skill, setSkill] = useState('')
  const [strength, setStrength] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof ProfileForm>(k: K, v: ProfileForm[K]) => setF((p) => ({ ...p, [k]: v }))
  const err = (k: string) => (errors[k] ? t(errors[k]) : null)

  async function save() {
    // A skill or strength typed but not yet added is saved too.
    const form = { ...f, skills: withItem(f.skills, skill), strengths: withItem(f.strengths, strength) }
    setF(form)
    setSkill('')
    setStrength('')
    const found = validateProfile(form)
    setErrors(found)
    setFormError(null)
    if (Object.keys(found).length) return
    setBusy(true)
    try {
      // The name first: saving the profile then derives the public name from it (PATCH /me alone does not).
      const name = nameChange(form, user?.name ?? '')
      if (name !== null) await updateName(name)
      await saveMyProfile(profileBody(form))
      router.back()
    } catch (e) {
      // The form keeps everything the user typed.
      const fields = e instanceof ApiError ? serverFieldErrors(e) : {}
      setErrors(fields)
      if (needsFormError(fields, shownFields)) setFormError(errorText(e instanceof ApiError ? e.code : 'network'))
      setBusy(false)
    }
  }

  const business = f.providerType === 'business'
  const shownFields = ['name', 'displayName', 'bio', 'strengths', 'skills', 'experience', 'basePostcode', 'serviceRadiusKm', ...(business ? ['businessName', 'impressum'] : [])]
  return (
    <Card>
      <Field label={t('f.name')} value={f.name} onChangeText={(v) => set('name', v)} maxLength={100} autoComplete="name" textContentType="name" error={err('name')} />
      <Field label={t('myProfile.form.displayName')} hint={t('f.displayNameHint')} value={f.displayName} onChangeText={(v) => set('displayName', v)} maxLength={80} error={err('displayName')} />
      <Select
        label={t('f.type')}
        value={f.providerType}
        onChange={(v) => set('providerType', v)}
        options={[
          { value: 'individual', label: t('f.individual') },
          { value: 'business', label: t('f.business') },
        ]}
      />
      {business && (
        <>
          <Field label={t('f.businessName')} value={f.businessName} onChangeText={(v) => set('businessName', v)} maxLength={120} error={err('businessName')} />
          <Field label={t('provider.impressum')} value={f.impressum} onChangeText={(v) => set('impressum', v)} multiline maxLength={1000} style={styles.multi} error={err('impressum')} />
        </>
      )}
      <Field label={t('f.bio')} value={f.bio} onChangeText={(v) => set('bio', v)} multiline maxLength={2000} style={styles.multi} error={err('bio')} />
      <TagInput
        label={t('provider.strengths')}
        items={f.strengths}
        onItems={(v) => set('strengths', v)}
        text={strength}
        onText={setStrength}
        max={MAX_SKILLS}
        maxLength={MAX_SKILL_LENGTH}
        addLabel={t('f.strengthAdd')}
        error={err('strengths')}
      />

      <TagInput
        label={t('provider.skills')}
        items={f.skills}
        onItems={(v) => set('skills', v)}
        text={skill}
        onText={setSkill}
        max={MAX_SKILLS}
        maxLength={MAX_SKILL_LENGTH}
        addLabel={t('f.skillAdd')}
        error={err('skills')}
      />

      <Field label={t('provider.experience')} hint={t('f.experienceHint')} value={f.experience} onChangeText={(v) => set('experience', v)} multiline maxLength={500} style={styles.multi} error={err('experience')} />
      <Field label={t('search.postcode')} value={f.basePostcode} onChangeText={(v) => set('basePostcode', v)} keyboardType="number-pad" maxLength={5} error={err('basePostcode')} />
      <Field label={t('f.radius')} value={f.serviceRadiusKm} onChangeText={(v) => set('serviceRadiusKm', v)} keyboardType="number-pad" maxLength={3} error={err('serviceRadiusKm')} />
      <SwitchRow label={t('f.remote')} value={f.worksRemotely} onChange={(v) => set('worksRemotely', v)} />

      <ErrorText text={formError} />
      <Button label={t('common.save')} onPress={save} busy={busy} />
    </Card>
  )
}

const styles = StyleSheet.create({
  multi: { minHeight: 72, paddingTop: 10, textAlignVertical: 'top' },
})
