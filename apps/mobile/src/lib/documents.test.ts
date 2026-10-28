import type { Category, Document, OwnService } from '@kando/contract'
import { DOC_COLORS, canShare, deleteBodyKey, docTone, documentRows, serviceDocNote, submittedDocs, type DocumentRow } from './documents'

const cats = [
  { id: 'c1', requiredDocuments: ['police-certificate'] },
  { id: 'c2', requiredDocuments: null },
  { id: 'c5', requiredDocuments: ['id-document', 'police-certificate'], optionalDocuments: ['liability-insurance', 'first-aid-certificate', 'police-certificate'] },
] as Category[]
const svc = (category: string) => ({ category }) as OwnService
const v = (id: string, status: Document['status'], reviewedAt: string | null, note: string | null = null): Document => ({
  id,
  requirement: 'police-certificate',
  status,
  note,
  reviewedAt,
  createdAt: '2026-01-01T00:00:00Z',
})

test('no rows when no service needs a document', () => {
  expect(documentRows([svc('c2')], cats, [])).toEqual([])
})

test('a babysitting service with nothing uploaded → police-certificate none', () => {
  expect(documentRows([svc('c1')], cats, [])).toEqual([{ requirement: 'police-certificate', optional: false, state: 'none', note: null }])
})

test('the most recently reviewed check decides, like the server', () => {
  // approved reviewed later (v1) than the rejection (v2, uploaded later)
  const a = documentRows([svc('c1')], cats, [v('v1', 'approved', '2026-03-01'), v('v2', 'rejected', '2026-02-01', 'blurry')])
  expect(a[0].state).toBe('approved')
  const b = documentRows([svc('c1')], cats, [v('v1', 'approved', '2026-02-01'), v('v2', 'rejected', '2026-03-01', 'blurry')])
  expect(b[0]).toEqual({ requirement: 'police-certificate', optional: false, state: 'rejected', note: 'blurry' })
})

test('a pending check shows pending even after an approval', () => {
  expect(documentRows([svc('c1')], cats, [v('v1', 'approved', '2026-03-01'), v('v2', 'pending', null)])[0].state).toBe('pending')
})

test('a requirement code the app does not know still gets a row, after the known ones', () => {
  const c = [{ id: 'c3', requiredDocuments: ['first-aid', 'permit', 'police-certificate'] }] as Category[]
  expect(documentRows([svc('c3')], c, []).map((r) => r.requirement)).toEqual(['police-certificate', 'permit', 'first-aid'])
})

test('two services needing the same document give one row', () => {
  expect(documentRows([svc('c1'), svc('c1')], cats, [])).toHaveLength(1)
})

test('two different categories needing the same document give one row with the latest status', () => {
  const c = [...cats, { id: 'c4', requiredDocuments: ['police-certificate', 'permit'] }] as Category[]
  const rows = documentRows([svc('c1'), svc('c4')], c, [v('v1', 'rejected', '2026-02-01', 'blurry'), v('v2', 'approved', '2026-03-01')])
  expect(rows).toEqual([
    { requirement: 'police-certificate', optional: false, state: 'approved', note: null },
    { requirement: 'permit', optional: false, state: 'none', note: null },
  ])
})

test('a hidden service says a document is needed until it is uploaded, then that it waits for the check', () => {
  const row = (state: DocumentRow['state']): DocumentRow => ({ requirement: 'police-certificate', optional: false, state, note: null })
  expect(serviceDocNote(['police-certificate'], [row('none')])).toBe('needed')
  expect(serviceDocNote(['police-certificate'], [row('rejected')])).toBe('needed')
  expect(serviceDocNote(['police-certificate'], [row('pending')])).toBe('waiting')
  expect(serviceDocNote(['police-certificate'], [])).toBe('needed')
})

test('sharing is allowed only while no service waits for a document', () => {
  const w = (waitingFor?: string[]) => ({ waitingFor }) as OwnService
  expect(canShare([w(['permit']), w()])).toBe(false)
  expect(canShare([w([]), w()])).toBe(true)
  expect(canShare([])).toBe(true)
})

test('saving a waiting service keeps Share hidden: the server answer carries waitingFor', () => {
  const list = [{ id: 'a', waitingFor: ['police-certificate'] }, { id: 'b', waitingFor: [] }] as OwnService[]
  const saved = { id: 'a', title: 'Neu', waitingFor: ['police-certificate'], visibleInSearch: false } as OwnService
  expect(canShare(list.map((s) => (s.id === saved.id ? saved : s)))).toBe(false)
})

test('submitted documents of a requirement, newest first', () => {
  const a = { ...v('a', 'rejected', '2026-02-01'), createdAt: '2026-02-01T00:00:00Z' }
  const b = { ...v('b', 'pending', null), createdAt: '2026-03-01T00:00:00Z' }
  const other = { ...v('c', 'pending', null), requirement: 'permit' }
  expect(submittedDocs('police-certificate', [a, other, b]).map((d) => d.id)).toEqual(['b', 'a'])
})

test('the delete confirmation says services go offline only for an approved document', () => {
  expect(deleteBodyKey('approved')).toBe('myProfile.docDeleteBody.approved')
  for (const status of ['pending', 'rejected'] as const) expect(deleteBodyKey(status)).toBe('myProfile.docDeleteBody')
})

test('optional documents get rows after the required ones, in display order, marked optional', () => {
  const rows = documentRows([svc('c5')], cats, [{ ...v('v1', 'approved', '2026-03-01'), requirement: 'first-aid-certificate' }])
  expect(rows.map((r) => [r.requirement, r.optional, r.state])).toEqual([
    ['id-document', false, 'none'],
    ['police-certificate', false, 'none'],
    ['liability-insurance', true, 'none'],
    ['first-aid-certificate', true, 'approved'],
  ])
})

test('a type that one service requires and another lists as optional is one required row', () => {
  const c = [{ id: 'a', requiredDocuments: ['liability-insurance'], optionalDocuments: [] }, { id: 'b', requiredDocuments: [], optionalDocuments: ['liability-insurance'] }] as unknown as Category[]
  expect(documentRows([svc('b'), svc('a')], c, [])).toEqual([{ requirement: 'liability-insurance', optional: false, state: 'none', note: null }])
})

test('waiting for a document ignores optional rows', () => {
  const rows = documentRows([svc('c5')], cats, [])
  expect(serviceDocNote(['police-certificate'], rows)).toBe('needed')
  expect(canShare([{ waitingFor: [] } as unknown as OwnService])).toBe(true) // optional rows never set waitingFor
})

test('a compulsory document not approved is red, an optional one orange, pending neutral, approved green', () => {
  const row = (optional: boolean, state: DocumentRow['state']): DocumentRow => ({ requirement: 'permit', optional, state, note: null })
  expect(docTone(row(false, 'none'))).toBe('required')
  expect(docTone(row(false, 'rejected'))).toBe('required')
  expect(docTone(row(true, 'none'))).toBe('optional')
  expect(docTone(row(true, 'rejected'))).toBe('optional')
  for (const optional of [false, true]) {
    expect(docTone(row(optional, 'pending'))).toBe('pending')
    expect(docTone(row(optional, 'approved'))).toBe('approved')
  }
  expect(new Set(Object.values(DOC_COLORS)).size).toBe(4)
})
