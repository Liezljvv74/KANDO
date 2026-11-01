import { formatMoney, LOCALE, TIME_ZONE } from '@kando/i18n'
import { toCents } from '../payments/rules'
import { providerParty, type InvoiceInput, type Party } from '../invoices/build'
import { renderLinesPdf } from '../invoices/pdf'
import { S19_NOTE, vatRate } from '../invoices/rules'

// All wording here must be checked by a tax adviser before launch (README launch item), as for invoices.

/**
 * The quote as it was issued (the snapshot kept in quote_documents.draft). Place is postcode and city only: the customer's
 * street stays private until the customer confirms (never in this snapshot, which both people can read).
 */
export type QuoteDraft = {
  issuer: Party
  customerName: string
  /** "10115 Berlin" for an on-site job, null when the job is remote. */
  place: string | null
  /** Null: the quote says "date and time to be confirmed". */
  startAt: string | null
  durationMin: number | null
  scope: string
  /** Gross, as the customer pays. */
  amount: number
  currency: string
  legalStatus: 'private' | 'kleinunternehmer' | 'business'
  /** 0 unless the provider is a VAT business; stored so the snapshot prints the rate that was used. */
  vatRate: number
  validUntil: string
  /** 1 for the first quote; the revision count printed is version - 1. */
  version: number
  notes: string[]
}

export type QuoteDraftInput = {
  provider: InvoiceInput['provider']
  country: string
  customerName: string
  place: string | null
  startAt: Date | null
  durationMin: number | null
  scope: string
  amount: number
  currency: string
  validUntil: Date
  version: number
}

export function buildQuoteDraft(i: QuoteDraftInput): QuoteDraft {
  const p = i.provider
  const legalStatus = p.legalStatus === 'kleinunternehmer' || p.legalStatus === 'business' ? p.legalStatus : 'private'
  return {
    issuer: providerParty(p),
    customerName: i.customerName,
    place: i.place,
    startAt: i.startAt ? i.startAt.toISOString() : null,
    durationMin: i.durationMin,
    scope: i.scope,
    amount: i.amount,
    currency: i.currency,
    legalStatus,
    vatRate: legalStatus === 'business' ? vatRate(i.country) : 0,
    validUntil: i.validUntil.toISOString(),
    version: i.version,
    notes: legalStatus === 'kleinunternehmer' ? [`${S19_NOTE.de} / ${S19_NOTE.en}`] : [],
  }
}

/** The text lines the PDF draws (the first is the title): German labels with English in brackets, one document for both people. */
export function quoteLines(d: QuoteDraft, number: string): string[] {
  const lang = 'de'
  const m = (x: number) => formatMoney(x, d.currency, lang)
  const when = (iso: string) => new Date(iso).toLocaleString(LOCALE[lang], { timeZone: TIME_ZONE, dateStyle: 'full', timeStyle: 'short' })
  const date = (iso: string) => new Date(iso).toLocaleDateString(LOCALE[lang], { timeZone: TIME_ZONE })
  const hours = (min: number) => `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`
  const party = (label: string, x: Party) => [label, ...(x.address?.startsWith(x.name) ? [] : [x.name]), ...(x.address ? [x.address] : []), ...(x.taxId ? [`Steuernummer / USt-IdNr. (Tax number / VAT ID): ${x.taxId}`] : [])]
  const rev = number.match(/_Rev\.(\d+)$/)?.[1]
  const out = [
    'Angebot (Quote)',
    ...(rev ? [`Überarbeitung Nr. ${rev} dieses Angebots (Revision ${rev} of this quote)`] : []),
    ...party('Von (From):', d.issuer),
    `An (To): ${d.customerName}`,
    `Leistung (Service): ${d.scope}`,
    d.place ? `Ort (Place): ${d.place}` : 'Ort (Place): Remote (remote)',
    d.startAt ? `Termin (Date and time): ${when(d.startAt)}` : 'Termin (Date and time): Datum und Uhrzeit werden noch bestätigt (to be confirmed)',
    ...(d.durationMin ? [`Dauer (Duration): ${hours(d.durationMin)}`] : []),
  ]
  if (d.legalStatus === 'business') {
    const grossCents = toCents(d.amount)
    const netCents = Math.round(Number((grossCents / (1 + d.vatRate)).toPrecision(15)))
    const net = netCents / 100
    const vat = (grossCents - netCents) / 100 // cents arithmetic: net + VAT always equals the gross
    const pct = new Intl.NumberFormat(LOCALE[lang], { style: 'percent', maximumFractionDigits: 2 }).format(d.vatRate)
    out.push(`Gesamtbetrag netto (Total net): ${m(net)}, USt. ${pct} (VAT ${pct}): ${m(vat)}, brutto (gross): ${m(d.amount)}`)
  } else out.push(`Gesamtbetrag (Total): ${m(d.amount)}`)
  out.push(`Gültig bis (Valid until): ${date(d.validUntil)}`, 'Dies ist ein Angebot, keine Rechnung (This is a quote, not an invoice).')
  return [...out, ...d.notes]
}

/** The quote as a PDF (the invoice layout: A4, Helvetica, the TEST watermark for a test number). The dates are the issue date, so a re-render is the same document. */
export const renderQuotePdf = (d: QuoteDraft, number: string, issuedAt: Date, test: boolean): Promise<Uint8Array> => renderLinesPdf(quoteLines(d, number), number, issuedAt, test)
