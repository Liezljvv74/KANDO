import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { AdminListQuerySchema, parseBody, parseQuery, ServiceInputSchema } from './index'

const service = {
  categoryId: '3f1c2a52-6a40-4a2c-9f44-6d1f5a8c9b11',
  title: 'Garden work',
  priceType: 'fixed',
  price: 20,
  currency: 'EUR',
}

describe('ServiceInputSchema', () => {
  it('rejects three decimals and negative prices', () => {
    expect(ServiceInputSchema.safeParse(service).success).toBe(true)
    expect(ServiceInputSchema.safeParse({ ...service, price: 20.005 }).success).toBe(false)
    expect(ServiceInputSchema.safeParse({ ...service, price: -1 }).success).toBe(false)
    expect(ServiceInputSchema.safeParse({ ...service, price: 20.5 }).success).toBe(true)
  })

  it('needs no price on request', () => {
    expect(
      ServiceInputSchema.safeParse({ ...service, priceType: 'on-request', price: null }).success,
    ).toBe(true)
    expect(
      ServiceInputSchema.safeParse({ ...service, priceType: 'fixed', price: null }).success,
    ).toBe(false)
  })
})

describe('AdminListQuerySchema', () => {
  it('caps pageSize at 100', () => {
    expect(AdminListQuerySchema.safeParse({ page: '1', pageSize: '100' }).success).toBe(true)
    expect(AdminListQuerySchema.safeParse({ page: '1', pageSize: '101' }).success).toBe(false)
    expect(AdminListQuerySchema.parse({}).pageSize).toBe(25)
  })
})

describe('parse helpers', () => {
  const schema = z.object({ n: z.number() })
  it('parseBody answers 400 with the issues', async () => {
    const bad = new Request('http://x/', { method: 'POST', body: '{"n":"a"}' })
    const err = await parseBody(schema, bad).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Response)
    expect((err as Response).status).toBe(400)
    const json = (await (err as Response).json()) as { error: string; issues: unknown[] }
    expect(json.error).toBe('Invalid input')
    expect(json.issues.length).toBe(1)
    expect(
      await parseBody(schema, new Request('http://x/', { method: 'POST', body: '{"n":1}' })),
    ).toEqual({ n: 1 })
  })

  it('parseQuery reads the search params', () => {
    expect(
      parseQuery(z.object({ page: z.coerce.number() }), new Request('http://x/?page=2')),
    ).toEqual({ page: 2 })
  })
})
