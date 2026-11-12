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
import { loadNextStep } from '@/lib/flow-state'
import { sendNow } from '@/lib/pending-runner'
import { dropService, putEntry, subscribe, usePendingEntry } from '@/lib/pending-saves'
import { parsePrice } from '@/lib/profile-form'
import { serviceMissing } from '@/lib/required-fields'
import { categoryEntry, createBody, createdService, refusedCreate } from '@/lib/serial-create'
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
  const accountId = useSession().user?.id ?? ''
  // A new-service screen opens on a refused create (the banner's way back to it), else starts a new temporary id.
  const [refused] = useState(() => (initial ? undefined : refusedCreate(accountId)))
  const [tmpRef] = useState(() => refused?.serviceRef ?? `tmp:${Date.now()}`) // a new service is kept under this until the server has created it
  const createKey = `service-create:${tmpRef}`
  const createEntry = usePendingEntry(createKey)
  const created = useSyncExternalStore(subscribe, () => createdService(tmpRef)) // set when the queued create succeeds, also in the background
  const id = initial?.id ?? created?.id ?? null
  const idRef = useRef(id)
  idRef.current = id
  const categoryKept = usePendingEntry(id ? `service:${id}:category` : '') // a kept category change of an existing service
  const [category, setCategory] = useState(
    (categoryKept?.body as { categoryId?: string } | undefined)?.categoryId ?? initial?.category ?? (refused?.body as { categoryId?: string } | undefined)?.categoryId ?? null,
  )
  const [waitingFor, setWaitingFor] = useState(initial?.waitingFor ?? [])
  const [code, setCode] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const onService = (s: OwnService) => setWaitingFor(s.waitingFor ?? [])
  useEffect(() => {
    if (created) setWaitingFor(created.waitingFor ?? [])
  }, [created])
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

  async function chooseCategory(categoryId: string) {
    setCategory(categoryId)
    setBusy(true)
    setCode((c) => ({ ...c, category: '' }))
    try {
      const sid = idRef.current
      if (sid) {
        // Kept and sent like the other fields: a failure after the screen is left is retried and shown by the banner.
        putEntry(categoryEntry(sid, accountId, categoryId))
        if ((await sendNow(`service:${sid}:category`)) === 'ok') servicesApi.list().then((l) => { const s = l.find((x) => x.id === sid); if (s) onService(s) }, () => {})
      } else {
        // Kept on the phone and sent by the 'service-create' sender (choosing again before it succeeds replaces it); the
        // fields wait for it and are then sent with the real id.
        putEntry({ key: createKey, kind: 'service-create', accountId, body: createBody(createEntry, categoryId, knownIds), serviceRef: tmpRef, route: '/my-profile/service/new', field: 'category' })
        await sendNow(createKey)
      }
      void loadNextStep().catch(() => {}) // the category may ask for a document: Done reads the next step from held data
    } catch (e) {
      setCode((c) => ({ ...c, category: e instanceof ApiError ? e.code : 'network' }))
    }
    setBusy(false)
  }
  const kept = createEntry ?? categoryKept
  const categoryError = code.category || (kept?.attempts ? (kept.state === 'refused' ? (kept.reason ?? 'network') : 'network') : '')

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
  // Done: every unsaved field is sent (never awaited); while the create is queued they are kept and follow it.
  const done = useDone({
    isProvider: true,
    step: 'service',
    missing: () => serviceMissing({ category, priceType: priceType.value, price: price.value }),
    flush: () => Promise.all([title, description, priceType, price].map((f) => f.flush())),
  })
  const priceInvalid = price.value.trim() !== '' && parsePrice(price.value) === null

  return (
    <FormScreen title={screenTitle} footer={<DoneBar onPress={done.onDone} message={done.message} />}>
    <Card>
      <Select {...compulsory('category')} value={category} onChange={(c) => void chooseCategory(c)} options={(categories ?? []).map((c) => ({ value: c.id, label: c.name }))} searchable />
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
