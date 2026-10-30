import { inflateSync } from 'node:zlib'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import type { InvoiceDraft, InvoiceLine } from './build'
import { entityHasPlaceholders, PLATFORM_ENTITY, platformDocumentsBlocked } from './entity'
import { formatNumber, isTestNumber, providerSeries, yearOf } from './numbering'
import { pdfSafe, renderPdf, TEST_WATERMARK } from './pdf'

const line = (i: number): InvoiceLine => ({ bookingId: `b${i}`, kind: i ? 'additional-task' : 'job', description: `Arbeit ${i} äöüß`, serviceDate: '2026-10-29', labour: 80, material: 20, net: 100, vat: 0, gross: 100 })
const draft = (lines = 1, name = 'Zoë Łukasz 😀'): InvoiceDraft => ({
  kind: 'receipt',
  legalStatus: 'private',
  issuer: { name: 'Jürgen Groß', address: '10115 Berlin', taxId: null },
  recipient: { name, address: 'Straße 1, 10115 Berlin', taxId: null },
  lines: Array.from({ length: lines }, (_, i) => line(i)),
  totals: { net: 100 * lines, vat: 0, gross: 100 * lines, labour: 80 * lines, material: 20 * lines },
  vatRate: 0,
  currency: 'EUR',
  notes: ['Ausgestellt im Namen und für Rechnung von Jürgen Groß'],
})

/** The text the pages draw: pdf-lib writes Helvetica strings as hex in (deflated) content streams. */
async function drawn(bytes: Uint8Array): Promise<string> {
  const raw = Buffer.from(bytes).toString('latin1')
  let text = ''
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let s: string
    try {
      s = inflateSync(Buffer.from(m[1]!, 'latin1')).toString('latin1')
    } catch {
      s = m[1]!
    }
    for (const h of s.matchAll(/<([0-9A-Fa-f]+)> Tj/g)) text += `${Buffer.from(h[1]!, 'hex').toString('latin1').replace(/\x80/g, '€')}\n` // WinAnsi 0x80 is the euro sign
  }
  return text
}

describe('renderPdf', () => {
  it('draws any name: German letters and the euro sign kept, the rest replaced, never a failure', async () => {
    const bytes = await renderPdf(draft(), 'ABCDEF12-2026-0001', new Date('2026-10-30T10:00:00Z'), false)
    expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe('%PDF-')
    const text = await drawn(bytes)
    expect(text).toContain('Zoë Lukasz ?')
    expect(text).toContain('Jürgen Groß')
    expect(text).toContain('ABCDEF12-2026-0001')
    expect(text).toContain('30.10.2026')
    expect(text).toMatch(/100,00\s€/)
    expect(text).not.toContain(TEST_WATERMARK)
  })

  it('marks every page of a test document and flows many lines onto more A4 pages', async () => {
    const bytes = await renderPdf(draft(60), 'ABCDEF12-2026-0002', new Date('2026-10-30T10:00:00Z'), true)
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBeGreaterThan(1)
    for (const page of doc.getPages()) expect([Math.round(page.getWidth()), Math.round(page.getHeight())]).toEqual([595, 842])
    expect((await drawn(bytes)).split(TEST_WATERMARK).length - 1).toBe(2 * doc.getPageCount())
    expect(await drawn(bytes)).toContain('Arbeit 59 äöüß')
  })

  it('a business invoice prints the VAT rate with net, VAT and gross (section 14 UStG)', async () => {
    const d: InvoiceDraft = { ...draft(), kind: 'invoice', legalStatus: 'business', vatRate: 0.19, lines: [{ ...line(0), net: 100, vat: 19, gross: 119 }], totals: { net: 100, vat: 19, gross: 119, labour: 99, material: 20 } }
    const text = await drawn(await renderPdf(d, 'ABCDEF12-2026-0003', new Date('2026-10-30T10:00:00Z'), false))
    expect(text).toContain('Rechnung (Invoice)')
    expect(text).toMatch(/USt\. 19\s%/)
    expect(text).toMatch(/Brutto \(Gross\): 119,00\s€/)
  })

  it('pdfSafe keeps WinAnsi text and replaces what Helvetica cannot draw', async () => {
    const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica)
    expect(pdfSafe('Ärger über Öl, Fuß: 12,50 €', font)).toBe('Ärger über Öl, Fuß: 12,50 €')
    expect(pdfSafe('Łódź Đorđe Ωmega 😀 x y', font)).toBe('Lódz Dorde ?mega ? x y')
  })
})

describe('numbering', () => {
  it('series per provider and Berlin year, four digits', () => {
    expect(yearOf(new Date('2026-12-31T22:59:59Z'))).toBe(2026)
    expect(yearOf(new Date('2026-12-31T23:00:00Z'))).toBe(2027)
    const id = 'abcdef12-3456-7890-abcd-ef1234567890'
    expect(providerSeries(id, 2026)).toBe(`${id}-2026`) // the counter: the full id, never shared by two providers
    expect(formatNumber(id, 2026, 7)).toBe('ABCDEF12-2026-0007') // the printed number: the short prefix
  })
})

describe('the platform entity guard', () => {
  const filled = { name: 'Kando GmbH', address: 'Hauptstr. 1, 10115 Berlin', register: 'HRB 1 B', vatId: 'DE123456789', vatNote: 'Umsatzsteuer 19 %' }
  it('blocks platform documents only when payments are live and a placeholder is left', () => {
    expect(entityHasPlaceholders()).toBe(true) // today: the legal entity does not exist yet
    expect(platformDocumentsBlocked(true)).toBe(true)
    expect(platformDocumentsBlocked(false)).toBe(false) // test documents (watermarked) are fine
    expect(platformDocumentsBlocked(true, filled)).toBe(false)
    expect(platformDocumentsBlocked(true, { ...filled, vatId: '[VAT ID]' })).toBe(true)
    expect(Object.keys(filled).sort()).toEqual(Object.keys(PLATFORM_ENTITY).sort())
  })
  it('test documents have their own series and a TEST- number', () => {
    const id = 'abcdef12-3456-7890-abcd-ef1234567890'
    expect(providerSeries(id, 2026, true)).toBe(`${id}-2026-test`)
    expect(formatNumber(id, 2026, 1, true)).toBe('TEST-ABCDEF12-2026-0001')
    expect([isTestNumber('TEST-ABCDEF12-2026-0001'), isTestNumber('ABCDEF12-2026-0001')]).toEqual([true, false])
  })
})
