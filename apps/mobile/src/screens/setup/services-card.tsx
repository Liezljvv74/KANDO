import { useRef, useState } from 'react'
import { Alert, StyleSheet, Text, View } from 'react-native'

import type { OwnService } from '@kando/contract'

import { ApiError } from '@/api/client'
import { servicesApi } from '@/api/my-profile'
import { ErrorText, Field } from '@/components/auth-ui'
import { Card, SectionHeader, SmallButton } from '@/components/form-ui'
import { Select } from '@/components/select'
import { useCategories } from '@/hooks/use-categories'
import { useFieldSave } from '@/hooks/use-field-save'
import { docText, errorText, t } from '@/i18n'
import { createSerial } from '@/lib/serial-create'
import { serviceDocNote, type DocumentRow } from '@/lib/documents'
import { parsePrice } from '@/lib/profile-form'

const PRICE_TYPES = ['fixed', 'hourly', 'from', 'on-request'] as const
const priceLabel = (p: string) => (p === 'on-request' ? t('price.onRequest') : t(`pt.${p}` as 'pt.fixed'))

let nextKey = 0

/**
 * One block per service. A block is created on the server when its category is chosen; every other field saves on its own.
 * The blocks and their typed values are read once from `services` (the card is mounted after the first load); `services`
 * stays the page's live list (kept by `onService` / `onRemoved`) and only feeds the "waiting for a document" notes.
 */
export function ServicesCard({
  services,
  docRows,
  onService,
  onRemoved,
}: {
  services: OwnService[]
  docRows: DocumentRow[]
  /** Every server answer for a service. */
  onService: (s: OwnService) => void
  onRemoved: (id: string) => void
}) {
  const [blocks, setBlocks] = useState(() => services.map((s) => ({ key: nextKey++, initial: s as OwnService | null })))
  return (
    <Card>
      <SectionHeader title={t('setup.services')} />
      {blocks.map((b) => (
        <ServiceBlock
          key={b.key}
          initial={b.initial}
          services={services}
          docRows={docRows}
          onService={onService}
          onRemoved={(id) => {
            if (id) onRemoved(id)
            setBlocks((x) => x.filter((y) => y.key !== b.key))
          }}
        />
      ))}
      <SmallButton label={t('setup.addService')} onPress={() => setBlocks((x) => [...x, { key: nextKey++, initial: null }])} />
    </Card>
  )
}

function ServiceBlock({
  initial,
  services,
  docRows,
  onService,
  onRemoved,
}: {
  initial: OwnService | null
  services: OwnService[]
  docRows: DocumentRow[]
  onService: (s: OwnService) => void
  onRemoved: (id: string | null) => void
}) {
  const { categories } = useCategories()
  const [id, setId] = useState(initial?.id ?? null)
  const idRef = useRef(id) // the savers read the id at send time, so a field typed right after the category still lands
  const [category, setCategory] = useState(initial?.category ?? null)
  const [code, setCode] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  // Choosing again before the create returns waits for it and updates: one service per block.
  const [serial] = useState(() => createSerial(initial?.id ?? null, (categoryId) => servicesApi.create({ categoryId }), (id, categoryId) => servicesApi.update(id, { categoryId })))

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
          if (!idRef.current) return onRemoved(null)
          try {
            await servicesApi.remove(idRef.current)
            onRemoved(idRef.current)
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
  const waitingFor = services.find((s) => s.id === id)?.waitingFor ?? []
  const priceInvalid = price.value.trim() !== '' && parsePrice(price.value) === null

  return (
    <View style={styles.block}>
      <Select label={t('search.category')} value={category} onChange={chooseCategory} options={(categories ?? []).map((c) => ({ value: c.id, label: c.name }))} searchable />
      {!category && <Text style={styles.hint}>{t('form.required')}</Text>}
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
            label={t('s.priceType')}
            value={priceType.value}
            onChange={(v) => {
              priceType.setValue(v)
              priceType.flush()
            }}
            options={PRICE_TYPES.map((p) => ({ value: p, label: priceLabel(p) }))}
          />
          {problem('priceType', priceType)}
          {priceType.value !== 'on-request' && (
            <Field label={t('s.price')} value={price.value} onChangeText={price.setValue} onBlur={price.flush} keyboardType="decimal-pad" error={priceInvalid ? t('s.priceError') : null} />
          )}
          {problem('price', price)}
        </>
      )}
      {busy && <Text style={styles.hint}>…</Text>}
      <ErrorText text={code.remove ? errorText(code.remove) : null} />
      <SmallButton label={t('setup.removeService')} onPress={remove} disabled={busy} />
    </View>
  )
}

const styles = StyleSheet.create({
  block: { gap: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#E1F4EE' },
  hint: { fontSize: 14, color: '#5C7A72' },
  waiting: { fontSize: 14, fontWeight: '600', color: '#8A5A00' },
  multi: { minHeight: 72, paddingTop: 10, textAlignVertical: 'top' },
})
