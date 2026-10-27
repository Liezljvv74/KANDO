import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Alert } from 'react-native'

import type { OwnService } from '@kando/contract'

import { ApiError } from '@/api/client'
import { servicesApi } from '@/api/my-profile'
import { Button, ErrorText, Field } from '@/components/auth-ui'
import { Card, FormScreen } from '@/components/form-ui'
import { Select } from '@/components/select'
import { Empty, ErrorRetry, Loading } from '@/components/state-view'
import { useCategories } from '@/hooks/use-categories'
import { useLoad } from '@/hooks/use-load'
import { errorText, t, useLang } from '@/i18n'
import { needsFormError, serverFieldErrors, serviceBody, validateService, type Errors, type ServiceForm } from '@/lib/profile-form'

const PRICE_TYPES = ['fixed', 'hourly', 'from', 'on-request'] as const
const priceLabel = (p: string) => (p === 'on-request' ? t('price.onRequest') : t(`pt.${p}` as 'pt.fixed'))

/** `id` set: edit that service; otherwise add a new one. */
export default function ServiceScreen({ id }: { id?: string }) {
  useLang()
  const { done, data, error, retry } = useLoad(servicesApi.list)
  const cats = useCategories()
  const existing = id == null ? undefined : data?.find((s) => s.id === id)
  const title = t(id == null ? 's.new' : 's.edit')
  const failure = error ?? cats.error
  return (
    <FormScreen title={title}>
      {!done || !cats.categories ? (
        failure ? <ErrorRetry code={failure} onRetry={() => (error ? retry() : cats.retry())} /> : <Loading />
      ) : id != null && !existing ? (
        <Empty text={t('error.notFound')} />
      ) : (
        <ServiceFormView existing={existing} categories={cats.categories} />
      )}
    </FormScreen>
  )
}

function ServiceFormView({ existing, categories }: { existing?: OwnService; categories: { id: string; name: string }[] }) {
  const router = useRouter()
  const [f, setF] = useState<ServiceForm>({
    category: existing?.category ?? null,
    title: existing?.title ?? '',
    description: existing?.description ?? '',
    priceType: existing?.priceType ?? 'fixed',
    price: existing?.price == null ? '' : String(existing.price).replace('.', ','),
  })
  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof ServiceForm>(k: K, v: ServiceForm[K]) => setF((p) => ({ ...p, [k]: v }))
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
      if (needsFormError(fields, ['category', 'title', 'description', ...(f.priceType === 'on-request' ? [] : ['price'])])) setFormError(errorText(e instanceof ApiError ? e.code : 'network'))
      setBusy(false)
    }
  }

  function save() {
    const found = validateService(f)
    setErrors(found)
    if (Object.keys(found).length) return
    run(() => (existing ? servicesApi.update(existing.id, serviceBody(f)) : servicesApi.create(serviceBody(f))))
  }

  const confirmDelete = () =>
    Alert.alert(t('s.deleteConfirm'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => run(() => servicesApi.remove(existing!.id)) },
    ])

  return (
    <Card>
      <Select label={t('search.category')} value={f.category} onChange={(v) => set('category', v)} options={categories.map((c) => ({ value: c.id, label: c.name }))} />
      <ErrorText text={err('category')} />
      <Field label={t('s.title')} value={f.title} onChangeText={(v) => set('title', v)} maxLength={120} error={err('title')} />
      <Field label={t('common.description')} value={f.description} onChangeText={(v) => set('description', v)} multiline maxLength={2000} style={{ minHeight: 72, paddingTop: 10, textAlignVertical: 'top' }} error={err('description')} />
      <Select label={t('s.priceType')} value={f.priceType} onChange={(v) => set('priceType', v)} options={PRICE_TYPES.map((p) => ({ value: p, label: priceLabel(p) }))} />
      {f.priceType !== 'on-request' && <Field label={t('s.price')} value={f.price} onChangeText={(v) => set('price', v)} keyboardType="decimal-pad" error={err('price')} />}
      <ErrorText text={formError} />
      <Button label={t('common.save')} onPress={save} busy={busy} />
      {existing && <Button label={t('common.delete')} onPress={confirmDelete} busy={busy} />}
    </Card>
  )
}
