import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { fixtures } from './ai-eval-fixtures'

describe('AI evaluation fixtures', () => {
  it('about twenty made-up documents, a mix of fine ones and clear problems, with unique ids', () => {
    const set = fixtures()
    expect(set).toHaveLength(20)
    expect(new Set(set.map((f) => f.id)).size).toBe(20)
    expect(set.filter((f) => f.expected === 'ok').length).toBeGreaterThanOrEqual(6)
    expect(set.filter((f) => f.expected === 'problem').length).toBeGreaterThanOrEqual(10)
  })

  it('every one renders locally to a real PDF or PNG', async () => {
    for (const f of fixtures()) {
      const { bytes, mime } = await f.render()
      if (mime === 'application/pdf') expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')
      else expect((await sharp(bytes).metadata()).format).toBe('png')
    }
  })
})
