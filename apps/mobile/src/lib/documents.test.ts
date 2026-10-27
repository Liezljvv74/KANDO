import type { Category, Document, OwnService } from '@kando/contract'
import { canShare, documentRows, serviceDocNote, type DocumentRow } from './documents'

const cats = [
  { id: 'c1', requiredDocuments: ['police-certificate'] },
  { id: 'c2', requiredDocuments: null },
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
  expect(documentRows([svc('c1')], cats, [])).toEqual([{ requirement: 'police-certificate', state: 'none', note: null }])
})

test('the most recently reviewed check decides, like the server', () => {
  // approved reviewed later (v1) than the rejection (v2, uploaded later)
  const a = documentRows([svc('c1')], cats, [v('v1', 'approved', '2026-03-01'), v('v2', 'rejected', '2026-02-01', 'blurry')])
  expect(a[0].state).toBe('approved')
  const b = documentRows([svc('c1')], cats, [v('v1', 'approved', '2026-02-01'), v('v2', 'rejected', '2026-03-01', 'blurry')])
  expect(b[0]).toEqual({ requirement: 'police-certificate', state: 'rejected', note: 'blurry' })
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
    { requirement: 'police-certificate', state: 'approved', note: null },
    { requirement: 'permit', state: 'none', note: null },
  ])
})

test('a hidden service says a document is needed until it is uploaded, then that it waits for the check', () => {
  const row = (state: DocumentRow['state']): DocumentRow => ({ requirement: 'police-certificate', state, note: null })
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
