import { describe, expect, it } from 'vitest'
import * as barrel from './index'
import * as testing from './testing'

describe('test hooks', () => {
  it('the barrel exports no *ForTests hook; testing.ts exports all four', () => {
    expect(Object.keys(barrel).filter((k) => k.endsWith('ForTests'))).toEqual([])
    expect(Object.keys(testing).sort()).toEqual(['outboxForTests', 'pushOutboxForTests', 'setGatewayForTests', 'setStorageForTests'])
  })
})
