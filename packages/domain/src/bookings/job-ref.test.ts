import { describe, expect, it } from 'vitest'

import { jobTitle, taskNumber } from './job-ref'

describe('jobTitle', () => {
  it("prefers the provider's title", () => {
    expect(jobTitle('  Gartenpflege  ', 'Garten')).toBe('Gartenpflege')
  })
  it('falls back to the category when the title is blank', () => {
    expect(jobTitle('   ', 'Garten')).toBe('Garten')
    expect(jobTitle(null, 'Garten')).toBe('Garten')
    expect(jobTitle(undefined, 'Garten')).toBe('Garten')
  })
})

describe('taskNumber', () => {
  it('is the job number for position 1', () => {
    expect(taskNumber(1040, 1)).toBe('#1040')
  })
  it('appends the position from 2', () => {
    expect(taskNumber(1040, 2)).toBe('#1040-2')
    expect(taskNumber(1040, 3)).toBe('#1040-3')
  })
})
