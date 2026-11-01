import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { formatQuoteNumber, isTestNumber, quoteSeries } from '../invoices/numbering'
import { buildQuoteDraft, quoteLines, renderQuotePdf, type QuoteDraftInput } from './pdf'

const input = (o: Partial<QuoteDraftInput> = {}): QuoteDraftInput => ({
  provider: { legalStatus: null, fullName: 'Jürgen Groß', businessName: null, impressum: null, vatId: null, taxNumber: null, basePostcode: '10115', basePlace: 'Berlin' },
  country: 'DE',
  customerName: 'Zoë Łukasz 😀',
  place: '10115 Berlin',
  startAt: new Date('2026-11-20T08:00:00Z'),
  durationMin: 150,
  scope: 'Zaun streichen äöüß',
  amount: 119,
  currency: 'EUR',
  validUntil: new Date('2026-11-12T08:00:00Z'),
  version: 1,
  ...o,
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
      continue
    }
    for (const h of s.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) text += Buffer.from(h[1]!, 'hex').toString('latin1')
  }
  return text
}

describe('quote numbers', () => {
  it('Q- first, the provider prefix, the year and four digits; TEST- first for a test quote', () => {
    expect(formatQuoteNumber('abcdef12-0000', 2026, 1)).toBe('Q-ABCDEF12-2026-0001')
    expect(formatQuoteNumber('abcdef12-0000', 2026, 12, true)).toBe('TEST-Q-ABCDEF12-2026-0012')
    expect(isTestNumber('TEST-Q-ABCDEF12-2026-0012_Rev.1')).toBe(true)
    expect(quoteSeries('p1', 2026)).not.toBe(quoteSeries('p1', 2026, true))
  })
})

describe('the quote document', () => {
  it('prints the number, the total, the start, the duration and "not an invoice"', async () => {
    const draft = buildQuoteDraft(input())
    const bytes = await renderQuotePdf(draft, 'Q-ABCDEF12-2026-0001', new Date('2026-11-01T10:00:00Z'), false)
    expect(bytes.length).toBeGreaterThan(500)
    const text = await drawn(bytes)
    expect(text).toContain('Q-ABCDEF12-2026-0001')
    expect(text).toContain('119,00')
    expect(text).toContain('2 h 30 min')
    expect(text).toContain('keine Rechnung')
    expect(text).toContain('20. November 2026')
  })

  it('a quote without a time says date and time are to be confirmed', () => {
    const lines = quoteLines(buildQuoteDraft(input({ startAt: null, durationMin: null })), 'Q-X-2026-0001').join('\n')
    expect(lines).toContain('werden noch bestätigt')
    expect(lines).not.toContain('Dauer')
  })

  it('a revision says which revision it is', () => {
    expect(quoteLines(buildQuoteDraft(input({ version: 3 })), 'Q-X-2026-0001_Rev.2').join('\n')).toContain('Überarbeitung Nr. 2')
  })

  it('a VAT business shows net and VAT; a small business the section 19 note; a private person neither', () => {
    const base = input().provider
    const biz = quoteLines(buildQuoteDraft(input({ provider: { ...base, legalStatus: 'business', businessName: 'Groß GmbH', impressum: 'Groß GmbH, Berlin', vatId: 'DE1' } })), 'Q').join('\n')
    expect(biz).toContain('netto')
    expect(biz).toContain('19')
    expect(quoteLines(buildQuoteDraft(input({ provider: { ...base, legalStatus: 'kleinunternehmer' } })), 'Q').join('\n')).toContain('§ 19 UStG')
    const priv = quoteLines(buildQuoteDraft(input()), 'Q').join('\n')
    expect(priv).not.toContain('netto')
    expect(priv).not.toContain('UStG')
  })

  it('the VAT line is computed in cents, so net plus VAT is the gross', () => {
    const base = input().provider
    const text = quoteLines(buildQuoteDraft(input({ amount: 100.1, provider: { ...base, legalStatus: 'business', businessName: 'Gross GmbH', impressum: 'Gross GmbH, Berlin', vatId: 'DE1' } })), 'Q').join(' ')
    expect(text).toContain('84,12') // net: 10010 cents / 1.19 rounded
    expect(text).toContain('15,98') // VAT: 10010 - 8412 cents
  })

  it('names with emoji and letters Helvetica lacks do not break the PDF; the test watermark is drawn for a test number', async () => {
    const bytes = await renderQuotePdf(buildQuoteDraft(input()), 'TEST-Q-ABCDEF12-2026-0001', new Date('2026-11-01T10:00:00Z'), true)
    expect(await drawn(bytes)).toContain('TESTDOKUMENT')
  })

  it('the street is not part of the snapshot', () => {
    expect(JSON.stringify(buildQuoteDraft(input({ place: '10115 Berlin' })))).not.toContain('Hauptstr')
  })
})
