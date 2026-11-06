import { describe, expect, it } from 'vitest'

import { MyProfileSchema } from './my-profile'

const base = { id: 'p1', status: 'draft', suspendedUntil: null, missing: [] }

describe('MyProfileSchema quoteSteps', () => {
  it('keeps the named steps', () => {
    expect(MyProfileSchema.parse({ ...base, quoteSteps: ['payout', 'taxId'] }).quoteSteps).toEqual(['payout', 'taxId'])
  })
  it('stays optional and rejects an unknown step', () => {
    expect(MyProfileSchema.parse(base).quoteSteps).toBeUndefined()
    expect(MyProfileSchema.safeParse({ ...base, quoteSteps: ['soul'] }).success).toBe(false)
  })
})
