import { useRouter } from 'expo-router'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Alert, StyleSheet, Text, View } from 'react-native'

import type { OwnService } from '@kando/contract'

import { ApiError } from '@/api/client'
import { documentsApi, servicesApi } from '@/api/my-profile'
import { ErrorText, Field } from '@/components/auth-ui'
import { Card, FormScreen, SmallButton } from '@/components/form-ui'
import { Select } from '@/components/select'
import { DoneBar } from '@/components/done-bar'
import { Empty, ErrorRetry, Loading } from '@/components/state-view'
import { useCategories } from '@/hooks/use-categories'
import { useDone } from '@/hooks/use-done'
import { useFieldSave } from '@/hooks/use-field-save'
import { useLoad } from '@/hooks/use-load'
import { useSession } from '@/hooks/use-session'
import { docText, errorText, t, useLang } from '@/i18n'
import { compulsory } from '@/lib/compulsory'
import { documentRows, serviceDocNote, type DocumentRow } from '@/lib/documents'
import { sendNow } from '@/lib/pending-runner'
import { dropService, putEntry, subscribe, usePendingEntry } from '@/lib/pending-saves'
import { parsePrice } from '@/lib/profile-form'
import { serviceMissing } from '@/lib/required-fields'
import { createdService } from '@/lib/serial-create'
import { color } from '@/theme'

const PRICE_TYPES = ['fixed', 'hourly', 'from', 'on-request'] as const
const priceLabel = (p: string) => (p === 'on-request' ? t('price.onRequest') : t(`pt.${p}` as 'pt.fixed'))

const noSave = async () => {} // every Service field is sent through the pending-saves store
const loadAll = async () => ({ services: await servicesApi.list(), verifications: await documentsApi.list() })

/** `id` set: edit that service; otherwise add a new one. */
export default function ServiceScreen({ id }: { id?: string }) {
  useLang()
  const { categories } = useCategories()
  const { done, data, error, retry } = useLoad(loadAll)
  const existing = id == null ? undefined : data?.services.find((s) => s.id === id)
  const title = t(id == null ? 's.new' : 's.edit')
  if (done && !(id != null && !existing)) return <ServiceForm title={title} initial={existing ?? null} knownIds={data!.services.map((s) => s.id)} docRows={documentRows(data!.services, categories ?? [], data!.verifications)} />
  return (
    <FormScreen title={title}>
      {!done ? error ? <ErrorRetry code={error} onRetry={retry} /> : <Loading /> : <Empty text={t('error.notFound')} />}
    </FormScreen>
  )
}

/**
 * One service. It is created on the server when its category is chosen; every other field saves on its own.
 * `initial` is read once; `docRows` only feeds the "waiting for a document" note.
 */
function ServiceForm({ title: screenTitle, initial, knownIds, docRows }: { title: string; initial: OwnService | null; knownIds: string[]; docRows: DocumentRow[] }) {
  const router = useRouter()
  const { categories } = useCategories()
  const [tmpRef] = useState(() => `tmp:${Date.now()}`) // a new service is kept under this until the server has created it
  const createKey = `service-create:${tmpRef}`
  const createEntry = usePendingEntry(createKey)
  const created = useSyncExternalStore(subscribe, () => createdService(tmpRef)) // set when the queued create succeeds, also in the background
  const id = initial?.id ?? created?.id ?? null
  const idRef = useRef(id)
  idRef.current = id
  const [category, setCategory] = useState(initial?.category ?? null)
  const [waitingFor, setWaitingFor] = useState(initial?.waitingFor ?? [])
  const [code, setCode] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const onService = (s: OwnService) => setWaitingFor(s.waitingFor ?? [])
  useEffect(() => {
    if (created) setWaitingFor(created.waitingFor ?? [])
  }, [created])
  const accountId = useSession().user?.id ?? ''
  const serviceRef = id ?? tmpRef
  // One field = one saver = one request; `toBody` null removes the stored change. The value is kept on the phone from the
  // first keystroke and sent by the 'service-field' sender; a reopened screen starts from a stored value.
  function useField<V>(key: string, initialValue: V, toBody: (v: V) => object | null, fromBody: (body: Record<string, never>) => V = (b) => b[key] as V) {
    const storeKey = `service:${serviceRef}:${key}`
    const pending = usePendingEntry(storeKey)
    return useFieldSave<V>(pending ? fromBody(pending.body as Record<string, never>) : initialValue, noSave, 600, {
      key: storeKey,
      kind: 'service-field',
      accountId,
      serviceRef,
      route: id ? `/my-profile/service/${id}` : '/my-profile/service/new',
      field: key,
      toBody,
    })
  }
  // An empty title is not sent: the server keeps the category name it filled in.
  const title = useField('title', initial?.title ?? '', (v) => (v.trim() ? { title: v.trim() } : null))
  const description = useField('description', initial?.description ?? '', (v) => ({ description: v.trim() }))
  const priceType = useField<string | null>('priceType', initial?.priceType ?? null, (v) => (v ? { priceType: v, ...(v === 'on-request' && { price: null }) } : null))
  const price = useField('price', initial?.price == null ? '' : String(initial.price).replace('.', ','), (v) => {
    const p = parsePrice(v)
    return p === null ? null : { price: p }
  }, (b) => String(b.price).replace('.', ','))

  const choosing = useRef<Promise<void>>(Promise.resolve())
  const categoryFailed = useRef(false) // the last category choice was refused or lost: Done must not report "Saved"
  async function chooseCategory(categoryId: string) {
    setCategory(categoryId)
    categoryFailed.current = false
    setBusy(true)
    setCode((c) => ({ ...c, category: '' }))
    try {
      if (idRef.current) onService(await servicesApi.update(idRef.current, { categoryId }))
      else {
        // Kept on the phone and sent by the 'service-create' sender (choosing again before it succeeds replaces it); the
        // fields wait for it and are then sent with the real id.
        putEntry({ key: createKey, kind: 'service-create', accountId, body: { categoryId, known: knownIds }, serviceRef: tmpRef, route: '/my-profile/service/new', field: 'category' })
        await sendNow(createKey)
      }
    } catch (e) {
      categoryFailed.current = true
      setCode((c) => ({ ...c, category: e instanceof ApiError ? e.code : 'network' }))
    }
    setBusy(false)
  }
  const categoryError = code.category || (createEntry?.attempts ? (createEntry.state === 'refused' ? (createEntry.reason ?? 'network') : 'network') : '')

  const remove = () =>
    Alert.alert(t('s.deleteConfirm'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          if (!idRef.current) {
            dropService(tmpRef)
            return router.back()
          }
          try {
            await servicesApi.remove(idRef.current)
            dropService(idRef.current)
            router.back()
          } catch (e) {
            setCode((c) => ({ ...c, remove: e instanceof ApiError ? (e.code === 'Profile incomplete' ? 'last-service' : e.code) : 'network' })) // a live profile must keep one service
          }
        },
      },
    ])

  const problem = (f: { status: string; errorCode: string | null; retry: () => void }) =>
    f.status === 'error' && f.errorCode ? (
      <View>
        <ErrorText text={errorText(f.errorCode)} />
        <SmallButton label={t('common.retry')} onPress={f.retry} />
      </View>
    ) : null
  const categoryName = categories?.find((c) => c.id === category)?.name
  // Done: wait for a running category create, then commit every field (true only if all saved).
  const done = useDone({
    isProvider: true,
    missing: () => serviceMissing({ category, priceType: priceType.value, price: price.value }),
    commit: async () => {
      await choosing.current // a category choice (create or update) still running
      if (categoryFailed.current || !idRef.current) return false // the category save failed (the error text shows) or the create failed: nothing to save into
      const all = await Promise.all([title, description, priceType, price].map((f) => f.commit()))
      return all.every(Boolean)
    },
  })
  const priceInvalid = price.value.trim() !== '' && parsePrice(price.value) === null

  return (
    <FormScreen title={screenTitle} footer={<DoneBar onPress={done.onDone} busy={done.busy} saved={done.saved} message={done.message} />}>
    <Card>
      <Select {...compulsory('category')} value={category} onChange={(c) => void (choosing.current = chooseCategory(c))} options={(categories ?? []).map((c) => ({ value: c.id, label: c.name }))} searchable />
      <ErrorText text={categoryError ? errorText(categoryError) : null} />
      {waitingFor.length > 0 && (
        <Text style={styles.waiting}>
          {t(serviceDocNote(waitingFor, docRows) === 'needed' ? 'myProfile.neededDocs' : 'myProfile.waitingDocs') + waitingFor.map(docText).join(', ')}
        </Text>
      )}
      {(id || createEntry) && (
        <>
          <Field label={t('s.title')} placeholder={categoryName} value={title.value} onChangeText={title.setValue} onBlur={title.flush} maxLength={120} />
          {problem(title)}
          <Field label={t('common.description')} value={description.value} onChangeText={description.setValue} onBlur={description.flush} multiline maxLength={2000} style={styles.multi} />
          {problem(description)}
          <Select
            {...compulsory('priceType')}
            value={priceType.value}
            onChange={(v) => {
              priceType.setValue(v)
              priceType.flush()
            }}
            options={PRICE_TYPES.map((p) => ({ value: p, label: priceLabel(p) }))}
          />
          {problem(priceType)}
          {priceType.value !== 'on-request' && (
            <Field {...compulsory('price')} value={price.value} onChangeText={price.setValue} onBlur={price.flush} keyboardType="decimal-pad" error={priceInvalid ? t('s.priceError') : null} />
          )}
          {problem(price)}
        </>
      )}
      {busy && <Text style={styles.hint}>…</Text>}
      <ErrorText text={code.remove ? errorText(code.remove) : null} />
      <SmallButton label={t('setup.removeService')} onPress={remove} disabled={busy} />
    </Card>
    </FormScreen>
  )
}

const styles = StyleSheet.create({
  hint: { fontSize: 14, color: color.inkMuted },
  waiting: { fontSize: 14, fontWeight: '600', color: '#8A5A00' },
  multi: { minHeight: 72, paddingTop: 10, textAlignVertical: 'top' },
})
