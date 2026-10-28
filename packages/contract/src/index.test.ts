import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  AddressSchema,
  AdminListQuerySchema,
  DOCUMENT_TYPES,
  DocumentsListSchema,
  OwnServicesListSchema,
  parseBody,
  parseQuery,
  PhotosListSchema,
  ReferenceInputSchema,
  ReferencesListSchema,
  ServiceInputSchema,
} from './index'

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

describe('list envelopes', () => {
  it('lists are { docs: [...] }', () => {
    const doc = { id: '1', kind: 'profile', url: null, alt: null }
    expect(PhotosListSchema.safeParse({ docs: [doc] }).success).toBe(true)
    expect(PhotosListSchema.safeParse([doc]).success).toBe(false)
    expect(OwnServicesListSchema.safeParse({ docs: [] }).success).toBe(true)
    expect(ReferencesListSchema.safeParse({ docs: [] }).success).toBe(true)
    expect(DocumentsListSchema.safeParse({ docs: [] }).success).toBe(true)
  })

  it('reference year is checked against the current year at parse time', () => {
    const ref = { clientName: 'A', description: 'B' }
    expect(
      ReferenceInputSchema.safeParse({ ...ref, year: new Date().getFullYear() + 1 }).success,
    ).toBe(false)
    expect(ReferenceInputSchema.safeParse({ ...ref, year: 2020 }).success).toBe(true)
  })
})

describe('address', () => {
  const ok = { street: 'Weg 1', postcode: '10115', city: 'Berlin', country: 'DE' }
  it('only the postcode is required; blank street and city become null', () => {
    expect(AddressSchema.safeParse(ok).success).toBe(true)
    expect(AddressSchema.safeParse({ postcode: '10115', country: 'DE' }).success).toBe(true)
    for (const bad of ['', '  ']) expect(AddressSchema.safeParse({ ...ok, postcode: bad }).success, bad).toBe(false)
    expect(AddressSchema.safeParse({ street: 'Weg 1', country: 'DE' }).success).toBe(false)
    expect(AddressSchema.parse({ ...ok, street: ' ', city: '' })).toEqual({ postcode: '10115', street: null, city: null, country: 'DE' })
  })
})

describe('service input as the app sends it', () => {
  it('a category alone is valid (the server fills currency and title)', () => {
    expect(ServiceInputSchema.safeParse({ categoryId: service.categoryId }).success).toBe(true)
  })
})

describe('DOCUMENT_TYPES', () => {
  it('lists the nine types once each, in display order', () => {
    expect([...DOCUMENT_TYPES]).toEqual([
      'id-document',
      'trade-registration',
      'liability-insurance',
      'police-certificate',
      'hygiene-certificate',
      'food-business-registration',
      'permit',
      'craft-qualification',
      'first-aid-certificate',
    ])
  })
})
