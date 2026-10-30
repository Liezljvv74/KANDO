import { useRouter } from 'expo-router'
import { useRef, useState } from 'react'
import { Alert, StyleSheet, Text, View } from 'react-native'

import type { OwnService } from '@kando/contract'

import { ApiError } from '@/api/client'
import { documentsApi, servicesApi } from '@/api/my-profile'
import { ErrorText, Field } from '@/components/auth-ui'
import { Card, FormScreen, SmallButton } from '@/components/form-ui'
import { Select } from '@/components/select'
import { Empty, ErrorRetry, Loading } from '@/components/state-view'
import { useCategories } from '@/hooks/use-categories'
import { useFieldSave } from '@/hooks/use-field-save'
import { useLoad } from '@/hooks/use-load'
import { docText, errorText, t, useLang } from '@/i18n'
import { compulsory } from '@/lib/compulsory'
import { documentRows, serviceDocNote, type DocumentRow } from '@/lib/documents'
import { parsePrice } from '@/lib/profile-form'
import { createSerial } from '@/lib/serial-create'

const PRICE_TYPES = ['fixed', 'hourly', 'from', 'on-request'] as const
const priceLabel = (p: string) => (p === 'on-request' ? t('price.onRequest') : t(`pt.${p}` as 'pt.fixed'))

const loadAll = async () => ({ services: await servicesApi.list(), verifications: await documentsApi.list() })

/** `id` set: edit that service; otherwise add a new one. */
export default function ServiceScreen({ id }: { id?: string }) {
  useLang()
  const { categories } = useCategories()
  const { done, data, error, retry } = useLoad(loadAll)
  const existing = id == null ? undefined : data?.services.find((s) => s.id === id)
  return (
    <FormScreen title={t(id == null ? 's.new' : 's.edit')}>
      {!done ? (
        error ? <ErrorRetry code={error} onRetry={retry} /> : <Loading />
      ) : id != null && !existing ? (
        <Empty text={t('error.notFound')} />
      ) : (
        <ServiceForm initial={existing ?? null} docRows={documentRows(data!.services, categories ?? [], data!.verifications)} />
      )}
    </FormScreen>
  )
}

/**
 * One service. It is created on the server when its category is chosen; every other field saves on its own.
 * `initial` is read once; `docRows` only feeds the "waiting for a document" note.
 */
function ServiceForm({ initial, docRows }: { initial: OwnService | null; docRows: DocumentRow[] }) {
  const router = useRouter()
  const { categories } = useCategories()
  const [id, setId] = useState(initial?.id ?? null)
  const idRef = useRef(id) // the savers read the id at send time, so a field typed right after the category still lands
  const [category, setCategory] = useState(initial?.category ?? null)
  const [waitingFor, setWaitingFor] = useState(initial?.waitingFor ?? [])
  const [code, setCode] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  // Choosing again before the create returns waits for it and updates: one service per screen.
  const [serial] = useState(() => createSerial(initial?.id ?? null, (categoryId) => servicesApi.create({ categoryId }), (id, categoryId) => servicesApi.update(id, { categoryId })))

  const onService = (s: OwnService) => setWaitingFor(s.waitingFor ?? [])
  // One field = one saver = one request; `toBody` null skips the request.
  function useField<V>(key: string, initialValue: V, toBody: (v: V) => object | null) {
    return useFieldSave<V>(initialValue, async (v) => {
      const body = toBody(v)
      if (!body || !idRef.current) return
      try {
        onService(await servicesApi.update(idRef.current, body))
        setCode((c) => (c[key] ? { ...c, [key]: '' } : c))
      } catch (e) {
        setCode((c) => ({ ...c, [key]: e instanceof ApiError ? e.code : 'network' }))
        throw e
      }
    })
  }
  // An empty title is not sent: the server keeps the category name it filled in.
  const title = useField('title', initial?.title ?? '', (v) => (v.trim() ? { title: v.trim() } : null))
  const description = useField('description', initial?.description ?? '', (v) => ({ description: v.trim() }))
  const priceType = useField<string | null>('priceType', initial?.priceType ?? null, (v) => (v ? { priceType: v, ...(v === 'on-request' && { price: null }) } : null))
  const price = useField('price', initial?.price == null ? '' : String(initial.price).replace('.', ','), (v) => {
    const p = parsePrice(v)
    return p === null ? null : { price: p }
  })

  async function chooseCategory(categoryId: string) {
    setCategory(categoryId)
    setBusy(true)
    setCode((c) => ({ ...c, category: '' }))
    try {
      const s = await serial.choose(categoryId)
      idRef.current = s.id
      setId(s.id)
      onService(s)
    } catch (e) {
      setCode((c) => ({ ...c, category: e instanceof ApiError ? e.code : 'network' }))
    }
    setBusy(serial.creating())
  }

  const remove = () =>
    Alert.alert(t('s.deleteConfirm'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          if (!idRef.current) return router.back()
          try {
            await servicesApi.remove(idRef.current)
            router.back()
          } catch (e) {
            setCode((c) => ({ ...c, remove: e instanceof ApiError ? e.code : 'network' }))
          }
        },
      },
    ])

  const problem = (key: string, f: { status: string; retry: () => void }) =>
    f.status === 'error' && code[key] ? (
      <View>
        <ErrorText text={errorText(code[key])} />
        <SmallButton label={t('common.retry')} onPress={f.retry} />
      </View>
    ) : null
  const categoryName = categories?.find((c) => c.id === category)?.name
  const priceInvalid = price.value.trim() !== '' && parsePrice(price.value) === null

  return (
    <Card>
      <Select {...compulsory('category')} value={category} onChange={chooseCategory} options={(categories ?? []).map((c) => ({ value: c.id, label: c.name }))} searchable />
      <ErrorText text={code.category ? errorText(code.category) : null} />
      {waitingFor.length > 0 && (
        <Text style={styles.waiting}>
          {t(serviceDocNote(waitingFor, docRows) === 'needed' ? 'myProfile.neededDocs' : 'myProfile.waitingDocs') + waitingFor.map(docText).join(', ')}
        </Text>
      )}
      {id && (
        <>
          <Field label={t('s.title')} placeholder={categoryName} value={title.value} onChangeText={title.setValue} onBlur={title.flush} maxLength={120} />
          {problem('title', title)}
          <Field label={t('common.description')} value={description.value} onChangeText={description.setValue} onBlur={description.flush} multiline maxLength={2000} style={styles.multi} />
          {problem('description', description)}
          <Select
            {...compulsory('priceType')}
            value={priceType.value}
            onChange={(v) => {
              priceType.setValue(v)
              priceType.flush()
            }}
            options={PRICE_TYPES.map((p) => ({ value: p, label: priceLabel(p) }))}
          />
          {problem('priceType', priceType)}
          {priceType.value !== 'on-request' && (
            <Field {...compulsory('price')} value={price.value} onChangeText={price.setValue} onBlur={price.flush} keyboardType="decimal-pad" error={priceInvalid ? t('s.priceError') : null} />
          )}
          {problem('price', price)}
        </>
      )}
      {busy && <Text style={styles.hint}>…</Text>}
      <ErrorText text={code.remove ? errorText(code.remove) : null} />
      <SmallButton label={t('setup.removeService')} onPress={remove} disabled={busy} />
    </Card>
  )
}

const styles = StyleSheet.create({
  hint: { fontSize: 14, color: '#5C7A72' },
  waiting: { fontSize: 14, fontWeight: '600', color: '#8A5A00' },
  multi: { minHeight: 72, paddingTop: 10, textAlignVertical: 'top' },
})
