import { formatMoney } from '@kando/i18n'
import { describe, expect, it } from 'vitest'

import { buildInvoice, invoiceLines, type InvoiceInput } from './build'
import { PLATFORM_ENTITY } from './entity'
import { S19_NOTE, VAT_RATES } from './rules'

type B = InvoiceInput['bookings'][number]

const provider = (legalStatus: string | null): InvoiceInput['provider'] => ({
  legalStatus,
  fullName: 'Petra Pinsel',
  businessName: 'Malerei Pinsel',
  impressum: 'Malerei Pinsel, Hauptstr. 1, 10115 Berlin',
  vatId: 'DE123456789',
  taxNumber: '12/345/67890',
  basePostcode: '10115',
  basePlace: 'Berlin',
})
const customer = { fullName: 'Karl Kunde', jobAddress: 'Gartenweg 2, 10117 Berlin' }

const booking = (over: Partial<B> = {}): B => ({
  id: 'root',
  parentBookingId: null,
  status: 'completed',
  amount: 100,
  materialAmount: 0,
  providerShare: 100,
  startAt: new Date('2026-11-02T09:00:00Z'),
  title: 'Wand streichen',
  cancelledBy: null,
  noShow: null,
  ...over,
})

const build = (bookings: B[], legalStatus: string | null = 'business', country = 'DE') =>
  buildInvoice({ provider: provider(legalStatus), customer, bookings, country, currency: 'EUR' })

describe('rules and entity', () => {
  it('hold the plan values', () => {
    expect(VAT_RATES).toEqual({ DE: 0.19 })
    expect(S19_NOTE.de).toBe('Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.')
    expect(S19_NOTE.en).toBe('No VAT is charged under section 19 UStG (small business rule).')
    expect(Object.values(PLATFORM_ENTITY).every((v) => /^\[.+\]$/.test(v))).toBe(true)
  })
})

describe('buildInvoice', () => {
  it('kleinunternehmer: invoice with the section 19 note and no VAT', () => {
    const d = build([booking()], 'kleinunternehmer')!
    expect(d.kind).toBe('invoice')
    expect(d.notes.some((n) => n.includes(S19_NOTE.de) && n.includes(S19_NOTE.en))).toBe(true)
    expect(d.totals).toMatchObject({ net: 100, vat: 0, gross: 100 })
    expect(d.vatRate).toBe(0)
    expect(d.issuer).toEqual({ name: 'Malerei Pinsel', address: 'Malerei Pinsel, Hauptstr. 1, 10115 Berlin', taxId: 'DE123456789' })
  })

  it('business: 119.00 gross is 100.00 net and 19.00 VAT', () => {
    const d = build([booking({ amount: 119, providerShare: 119 })])!
    expect(d.kind).toBe('invoice')
    expect(d.lines[0]).toMatchObject({ gross: 119, net: 100, vat: 19 })
    expect(d.totals).toMatchObject({ net: 100, vat: 19, gross: 119 })
    expect(d.vatRate).toBe(0.19)
    const de = invoiceLines(d, 'de').join('\n')
    expect(de).toMatch(/Netto \(Net\): .*, USt\. 19\s%\s\(VAT 19\s%\): /)
    expect(de).toMatch(/Summe netto \(Total net\): .*, USt\. 19\s%\s\(VAT 19\s%\): /)
    expect(invoiceLines(d, 'en').join('\n')).toMatch(/USt\. 19% \(VAT 19%\)/)
    expect(d.notes.some((n) => n.includes('§ 19'))).toBe(false)
  })

  it('business without a VAT id uses the tax number', () => {
    const d = buildInvoice({ provider: { ...provider('business'), vatId: null }, customer, bookings: [booking()], country: 'DE', currency: 'EUR' })!
    expect(d.issuer.taxId).toBe('12/345/67890')
  })

  it('private: a receipt, no VAT, no section 19 note', () => {
    const d = build([booking()], 'private')!
    expect(d.kind).toBe('receipt')
    expect(d.vatRate).toBe(0)
    expect(d.totals).toMatchObject({ net: 100, vat: 0, gross: 100 })
    expect(d.notes.some((n) => n.includes('§ 19'))).toBe(false)
    expect(d.issuer).toEqual({ name: 'Petra Pinsel', address: '10115 Berlin', taxId: null })
    expect(d.notes.some((n) => n.startsWith('Ausgestellt im Namen und für Rechnung von Petra Pinsel durch '))).toBe(true)
  })

  it('null legalStatus is treated as private', () => {
    const d = build([booking()], null)!
    expect(d.kind).toBe('receipt')
    expect(d.legalStatus).toBe('private')
  })

  it('material 20 of 100 with a share of 50 gives material 10 and labour 40', () => {
    const d = build([booking({ materialAmount: 20, providerShare: 50, status: 'stopped' })])!
    expect(d.lines[0]).toMatchObject({ kind: 'job', material: 10, labour: 40, gross: 50 })
    const total = (lang: 'de' | 'en') => `Arbeitskosten (Labour): ${formatMoney(40, 'EUR', lang)}, Material (Material): ${formatMoney(10, 'EUR', lang)}`
    for (const lang of ['de', 'en'] as const) {
      const text = invoiceLines(d, lang)
      expect(text).toContain(total(lang))
      expect(text.join('\n').split('Arbeitskosten').length - 1).toBe(2) // once on the line, once in the totals
      expect(text.join('\n')).not.toContain(formatMoney(40, 'EUR', lang === 'de' ? 'en' : 'de'))
    }
    expect(d.notes.some((n) => n.includes('Arbeitskosten'))).toBe(false)
  })

  it('material greater than the share clamps to the share', () => {
    const d = build([booking({ amount: 100, materialAmount: 150, providerShare: 50, status: 'stopped' })])!
    expect(d.lines[0]).toMatchObject({ material: 50, labour: 0 })
  })

  it('rounding: odd cents and a 33.33% share give clean cents and totals equal the lines', () => {
    const d = build([
      booking({ amount: 99.99, materialAmount: 33.33, providerShare: 33.33, status: 'stopped' }),
      booking({ id: 'k1', parentBookingId: 'root', amount: 10.01, providerShare: 10.01, materialAmount: 3.33 }),
    ])!
    // material 33.33 * 33.33 / 99.99 = 11.11; 3.33 * 10.01 / 10.01 = 3.33
    expect(d.lines.map((l) => [l.material, l.labour])).toEqual([[11.11, 22.22], [3.33, 6.68]])
    // VAT per line from gross, half up: 33.33/1.19 = 28.0084 -> 28.01; 10.01/1.19 = 8.4118 -> 8.41
    expect(d.lines.map((l) => [l.net, l.vat])).toEqual([[28.01, 5.32], [8.41, 1.6]])
    expect(d.totals).toEqual({ net: 36.42, vat: 6.92, gross: 43.34, labour: 28.9, material: 14.44 })
    for (const l of d.lines) expect(Math.round(l.net * 100) + Math.round(l.vat * 100)).toBe(Math.round(l.gross * 100))
  })

  it('a refunded additional task has no line; a paid one is its own line labelled as additional task', () => {
    const d = build([
      booking(),
      booking({ id: 'k1', parentBookingId: 'root', status: 'refunded', providerShare: 0, title: 'Tür' }),
      booking({ id: 'k2', parentBookingId: 'root', amount: 30, providerShare: 30, materialAmount: 10, title: 'Fenster' }),
    ])!
    expect(d.lines.map((l) => [l.bookingId, l.kind])).toEqual([['root', 'job'], ['k2', 'additional-task']])
    expect(d.totals.gross).toBe(130)
    expect(d.totals.material).toBe(10)
  })

  it('a refunded status has no line even with a share', () => {
    expect(build([booking({ status: 'refunded' })])).toBeNull()
  })

  it('a late customer cancellation is a fee line with no labour or material', () => {
    const d = build([booking({ status: 'cancelled', cancelledBy: 'customer', providerShare: 50, materialAmount: 20 })])!
    expect(d.lines[0]).toMatchObject({ kind: 'late-cancel-fee', gross: 50, labour: 0, material: 0 })
  })

  it('a customer no-show is a fee line with the full share', () => {
    const d = build([booking({ status: 'cancelled', noShow: 'customer', providerShare: 100, materialAmount: 20 })])!
    expect(d.lines[0]).toMatchObject({ kind: 'no-show-fee', gross: 100, labour: 0, material: 0 })
  })

  it('a provider cancellation or provider no-show gives no line', () => {
    expect(build([booking({ status: 'cancelled', cancelledBy: 'provider', providerShare: 0 })])).toBeNull()
    expect(build([booking({ status: 'cancelled', noShow: 'provider', providerShare: 0 })])).toBeNull()
    expect(build([booking({ status: 'cancelled', cancelledBy: 'provider' })])).toBeNull() // even with a share by mistake
  })

  it('a stop with a full refund (share 0) gives no line', () => {
    expect(build([booking({ status: 'stopped', providerShare: 0 })])).toBeNull()
  })

  it('everything refunded returns null', () => {
    expect(build([booking({ status: 'refunded', providerShare: 0 }), booking({ id: 'k1', parentBookingId: 'root', status: 'refunded', providerShare: 0 })])).toBeNull()
  })

  it('orders lines deterministically: root first, then by start and id', () => {
    const t = (h: number) => new Date(Date.UTC(2026, 10, 2, h))
    const input = [
      booking({ id: 'kb', parentBookingId: 'root', startAt: t(10) }),
      booking({ id: 'ka', parentBookingId: 'root', startAt: t(10) }),
      booking({ id: 'k0', parentBookingId: 'root', startAt: t(8) }),
      booking({ id: 'root', startAt: t(9) }),
    ]
    expect(build(input)!.lines.map((l) => l.bookingId)).toEqual(['root', 'k0', 'ka', 'kb'])
    expect(build([...input].reverse())!.lines.map((l) => l.bookingId)).toEqual(['root', 'k0', 'ka', 'kb'])
  })

  it('service date is the Berlin calendar day', () => {
    const d = build([booking({ startAt: new Date('2026-01-31T23:30:00Z') })])!
    expect(d.lines[0]!.serviceDate).toBe('2026-02-01')
  })

  it('a remote booking has no recipient address', () => {
    const d = buildInvoice({ provider: provider('private'), customer: { fullName: 'Karl Kunde', jobAddress: null }, bookings: [booking()], country: 'DE', currency: 'EUR' })!
    expect(d.recipient).toEqual({ name: 'Karl Kunde', address: null, taxId: null })
  })

  it('an unknown country throws', () => {
    expect(() => build([booking()], 'business', 'ZA')).toThrow(/ZA/)
    expect(() => build([booking()], 'private', 'ZA')).toThrow(/ZA/)
  })
})

describe('invoiceLines', () => {
  it('has German labels with English in brackets and no undefined or NaN', () => {
    const d = build([
      booking({ materialAmount: 20 }),
      booking({ id: 'k1', parentBookingId: 'root', amount: 30, providerShare: 30, title: 'Fenster' }),
    ])!
    for (const lang of ['de', 'en'] as const) {
      const text = invoiceLines(d, lang).join('\n')
      expect(text).toContain('Rechnung (Invoice)')
      expect(text).toContain('Zusatzauftrag (Additional task)')
      expect(text).toContain('Arbeitskosten (Labour)')
      expect(text).toContain('(VAT 19')
      expect(text).not.toMatch(/undefined|NaN|null/)
    }
    expect(invoiceLines(d, 'de').join('\n')).toContain(formatMoney(130, 'EUR', 'de'))
    expect(invoiceLines(d, 'en').join('\n')).toContain(formatMoney(130, 'EUR', 'en'))
  })

  it('prints the business name once when the Impressum starts with it', () => {
    const text = invoiceLines(build([booking()])!, 'de')
    expect(text.filter((l) => l.includes('Malerei Pinsel'))).toEqual(['Malerei Pinsel, Hauptstr. 1, 10115 Berlin', expect.stringContaining('Ausgestellt')])
  })

  it('a receipt says so and shows no VAT', () => {
    const text = invoiceLines(build([booking()], 'private')!, 'de').join('\n')
    expect(text).toContain('Quittung (Receipt)')
    expect(text).not.toContain('USt.')
  })
})
