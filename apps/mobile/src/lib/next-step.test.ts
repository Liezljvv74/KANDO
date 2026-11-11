import type { DocumentRow } from './documents'
import { isOpenDocument, nextStep, openSteps } from './next-step'

const doc = (state: DocumentRow['state'], optional = false): DocumentRow => ({ requirement: 'photo-id', optional, state, note: null })
const base = { isProvider: true, accountComplete: true, profile: { missing: [], quoteSteps: [] }, docRows: [] as DocumentRow[] }

describe('openSteps', () => {
  it('customer: account only', () => {
    expect(openSteps({ ...base, isProvider: false, accountComplete: false, profile: null })).toEqual([{ kind: 'account', path: '/account' }])
    expect(openSteps({ ...base, isProvider: false, profile: null })).toEqual([])
  })

  it('provider order: account, about, service, document, payout', () => {
    const i = { ...base, accountComplete: false, profile: { missing: ['service', 'skills'] as ('service' | 'skills')[], quoteSteps: ['payout' as const] }, docRows: [doc('none')] }
    expect(openSteps(i)).toEqual([
      { kind: 'account', path: '/account' },
      { kind: 'about', path: '/my-profile/about?field=skills' },
      { kind: 'service', path: '/my-profile/service/new' },
      { kind: 'document', path: '/my-profile/document/photo-id' },
      { kind: 'payout' },
    ])
    expect(nextStep(i)).toEqual({ kind: 'account', path: '/account' })
  })

  it('a customer with the provider flag uses the provider order', () => {
    expect(openSteps({ ...base, profile: { missing: ['skills'], quoteSteps: [] } })).toEqual([{ kind: 'about', path: '/my-profile/about?field=skills' }])
  })

  it('documents: pending, approved and optional none are not open; rejected and required none are', () => {
    expect(openSteps({ ...base, docRows: [doc('pending'), doc('approved'), doc('none', true)] })).toEqual([])
    expect(openSteps({ ...base, docRows: [doc('rejected')] })).toHaveLength(1)
  })

  it('consent and taxId are not listed; null profile gives nothing', () => {
    expect(openSteps({ ...base, profile: { missing: [], quoteSteps: ['consent', 'taxId'] } })).toEqual([])
    expect(openSteps({ ...base, profile: null })).toEqual([])
    expect(nextStep({ ...base, profile: null })).toBeNull()
  })
})

describe('payout and documents', () => {
  it('payout never started is open; a form already sent is finished', () => {
    const profile = { missing: [], quoteSteps: ['payout' as const] }
    expect(openSteps({ ...base, profile })).toEqual([{ kind: 'payout' }])
    expect(openSteps({ ...base, profile, payoutSent: true })).toEqual([])
  })
  it('isOpenDocument: required none or rejected only', () => {
    expect(isOpenDocument(doc('none'))).toBe(true)
    expect(isOpenDocument(doc('rejected'))).toBe(true)
    expect(isOpenDocument(doc('none', true))).toBe(false)
    expect(isOpenDocument(doc('rejected', true))).toBe(false)
    expect(isOpenDocument(doc('pending'))).toBe(false)
  })
})
