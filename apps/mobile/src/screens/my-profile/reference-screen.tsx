import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Alert } from 'react-native'

import type { OwnReference } from '@kando/contract'

import { ApiError } from '@/api/client'
import { referencesApi } from '@/api/my-profile'
import { Button, ErrorText, Field } from '@/components/auth-ui'
import { Card, FormScreen } from '@/components/form-ui'
import { Empty, ErrorRetry, Loading } from '@/components/state-view'
import { useLoad } from '@/hooks/use-load'
import { errorText, t, useLang } from '@/i18n'
import { needsFormError, referenceBody, serverFieldErrors, validateReference, type Errors, type ReferenceForm } from '@/lib/profile-form'

/** `id` set: edit that reference; otherwise add a new one. */
export default function ReferenceScreen({ id }: { id?: string }) {
  useLang()
  const { done, data, error, retry } = useLoad(referencesApi.list)
  const existing = id == null ? undefined : data?.find((r) => r.id === id)
  return (
    <FormScreen title={t(id == null ? 'r.new' : 'r.edit')}>
      {!done ? error ? <ErrorRetry code={error} onRetry={retry} /> : <Loading /> : id != null && !existing ? <Empty text={t('error.notFound')} /> : <ReferenceFormView existing={existing} />}
    </FormScreen>
  )
}

function ReferenceFormView({ existing }: { existing?: OwnReference }) {
  const router = useRouter()
  const [f, setF] = useState<ReferenceForm>({
    clientName: existing?.clientName ?? '',
    description: existing?.description ?? '',
    year: existing?.year == null ? '' : String(existing.year),
  })
  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof ReferenceForm>(k: K, v: string) => setF((p) => ({ ...p, [k]: v }))
  const err = (k: string) => (errors[k] ? t(errors[k]) : null)

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setFormError(null)
    try {
      await action()
      router.back()
    } catch (e) {
      const fields = e instanceof ApiError ? serverFieldErrors(e) : {}
      setErrors(fields)
      if (needsFormError(fields, ['clientName', 'description', 'year'])) setFormError(errorText(e instanceof ApiError ? e.code : 'network'))
      setBusy(false)
    }
  }

  function save() {
    const found = validateReference(f)
    setErrors(found)
    if (Object.keys(found).length) return
    run(() => (existing ? referencesApi.update(existing.id, referenceBody(f)) : referencesApi.create(referenceBody(f))))
  }

  const confirmDelete = () =>
    Alert.alert(t('r.deleteConfirm'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => run(() => referencesApi.remove(existing!.id)) },
    ])

  return (
    <Card>
      <Field label={t('r.client')} value={f.clientName} onChangeText={(v) => set('clientName', v)} maxLength={120} error={err('clientName')} />
      <Field label={t('common.description')} value={f.description} onChangeText={(v) => set('description', v)} multiline maxLength={1000} style={{ minHeight: 96, paddingTop: 12, textAlignVertical: 'top' }} error={err('description')} />
      <Field label={t('r.year')} value={f.year} onChangeText={(v) => set('year', v)} keyboardType="number-pad" maxLength={4} error={err('year')} />
      <ErrorText text={formError} />
      <Button label={t('common.save')} onPress={save} busy={busy} />
      {existing && <Button label={t('common.delete')} onPress={confirmDelete} busy={busy} />}
    </Card>
  )
}
