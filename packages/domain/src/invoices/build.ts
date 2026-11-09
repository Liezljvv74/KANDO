import { formatMoney, LOCALE, t, TIME_ZONE, type Lang } from '@kando/i18n'

import { toCents } from '../payments/rules'
import { onBehalfNote, S19_NOTE, vatRate } from './rules'

// All wording here must be checked by a tax adviser before launch (README launch item).

export type Party = { name: string; address: string | null; taxId: string | null }

export type InvoiceLine = {
  bookingId: string
  kind: 'job' | 'additional-task' | 'late-cancel-fee' | 'no-show-fee'
  description: string
  serviceDate: string
  /** `#1040` or `#1040-2`: the job or additional task the line is for (absent on invoices issued before job numbers). */
  task?: string
  labour: number
  material: number
  net: number
  vat: number
  gross: number
}

export type InvoiceDraft = {
  kind: 'invoice' | 'receipt'
  legalStatus: 'private' | 'kleinunternehmer' | 'business'
  issuer: Party
  recipient: Party
  lines: InvoiceLine[]
  totals: { net: number; vat: number; gross: number; labour: number; material: number }
  /** The VAT rate applied to every line (0 unless business); stored so a snapshot prints the rate that was used. */
  vatRate: number
  currency: string
  notes: string[]
  /** The job the document is for (absent on documents issued before job numbers); the invoice keeps its own number. */
  job?: { number: number; title: string }
}

export type InvoiceInput = {
  provider: {
    legalStatus: string | null
    fullName: string
    businessName: string | null
    impressum: string | null
    vatId: string | null
    taxNumber: string | null
    basePostcode: string | null
    basePlace: string | null
  }
  /** jobAddress null for a remote booking. */
  customer: { fullName: string; jobAddress: string | null }
  /** The root booking and its additional tasks; amounts gross, providerShare from the settle ledger. */
  bookings: {
    id: string
    parentBookingId: string | null
    status: string
    amount: number
    providerShare: number
    startAt: Date
    title: string
    cancelledBy: string | null
    noShow: string | null
    task?: string
  }[]
  job?: { number: number; title: string }
  country: string
  currency: string
}

const eur = (cents: number) => cents / 100

/** The provider as printed on invoices (issuer of their own, recipient of the commission invoice), by legal status (null = private). */
export function providerParty(p: InvoiceInput['provider']): Party {
  return p.legalStatus === 'kleinunternehmer' || p.legalStatus === 'business'
    ? { name: p.businessName ?? p.fullName, address: p.impressum, taxId: p.vatId ?? p.taxNumber }
    : { name: p.fullName, address: [p.basePostcode, p.basePlace].filter(Boolean).join(' ') || null, taxId: null }
}
const day = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })

/**
 * The invoice (or receipt) for one booking group, or null when nothing was paid out to the provider.
 * Money is computed in integer cents, half up, so every amount has clean cents:
 * - One amount per line (labour = the share, material 0; fee lines have neither). Old stored drafts may carry a material part.
 * - VAT from gross per line: net = round(gross / (1 + rate)), vat = gross - net (119.00 -> 100.00 + 19.00); totals are
 *   the sums of the lines, so they always match. Labour and material are gross amounts (what section 35a EStG asks for).
 */
export function buildInvoice(input: InvoiceInput): InvoiceDraft | null {
  const rate = vatRate(input.country)
  const p = input.provider
  const legalStatus = p.legalStatus === 'kleinunternehmer' || p.legalStatus === 'business' ? p.legalStatus : 'private'
  const lineRate = legalStatus === 'business' ? rate : 0

  const sorted = [...input.bookings].sort(
    (a, b) =>
      Number(a.parentBookingId !== null) - Number(b.parentBookingId !== null) ||
      a.startAt.getTime() - b.startAt.getTime() ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )

  const lines: InvoiceLine[] = []
  for (const b of sorted) {
    const share = toCents(b.providerShare)
    if (share <= 0 || b.status === 'refunded' || b.cancelledBy === 'provider' || b.noShow === 'provider') continue
    const kind: InvoiceLine['kind'] =
      b.noShow === 'customer' ? 'no-show-fee'
      : b.cancelledBy === 'customer' ? 'late-cancel-fee'
      : b.parentBookingId ? 'additional-task'
      : 'job'
    const fee = kind === 'no-show-fee' || kind === 'late-cancel-fee'
    const net = Math.round(Number((share / (1 + lineRate)).toPrecision(15)))
    lines.push({
      bookingId: b.id,
      kind,
      description: b.title,
      serviceDate: day.format(b.startAt),
      ...(b.task && { task: b.task }),
      labour: eur(fee ? 0 : share),
      material: 0,
      net: eur(net),
      vat: eur(share - net),
      gross: eur(share),
    })
  }
  if (!lines.length) return null

  const sum = (k: 'net' | 'vat' | 'gross' | 'labour' | 'material') => eur(lines.reduce((s, l) => s + toCents(l[k]), 0))
  const totals = { net: sum('net'), vat: sum('vat'), gross: sum('gross'), labour: sum('labour'), material: sum('material') }

  const issuer = providerParty(p)

  // The labour and material totals (section 35a EStG) are printed by invoiceLines in the document language, not stored as a note.
  const notes = [
    ...(legalStatus === 'kleinunternehmer' ? [`${S19_NOTE.de} / ${S19_NOTE.en}`] : []),
    onBehalfNote(issuer.name, t('de', 'brand.name')),
  ]

  return {
    kind: legalStatus === 'private' ? 'receipt' : 'invoice',
    legalStatus,
    issuer,
    recipient: { name: input.customer.fullName, address: input.customer.jobAddress, taxId: null },
    lines,
    totals,
    vatRate: lineRate,
    currency: input.currency,
    notes,
    ...(input.job && { job: input.job }),
  }
}

const KIND_LABEL: Record<InvoiceLine['kind'], string> = {
  job: 'Leistung (Service)',
  'additional-task': 'Zusatzauftrag (Additional task)',
  'late-cancel-fee': 'Ausfallgebühr, späte Absage (Late cancellation fee)',
  'no-show-fee': 'Ausfallgebühr, nicht erschienen (No-show fee)',
}

/** The text lines the PDF draws: German labels with English in brackets (one document for both people); money and dates in `lang`. */
export function invoiceLines(draft: InvoiceDraft, lang: Lang): string[] {
  const m = (x: number) => formatMoney(x, draft.currency, lang)
  const date = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(LOCALE[lang], { timeZone: 'UTC' })
  const vat = draft.legalStatus === 'business'
  const pct = new Intl.NumberFormat(LOCALE[lang], { style: 'percent', maximumFractionDigits: 2 }).format(draft.vatRate)
  const ust = `USt. ${pct} (VAT ${pct})`
  // The Impressum usually starts with the business name: print the name only when it does not.
  const party = (label: string, x: Party) => [label, ...(x.address?.startsWith(x.name) ? [] : [x.name]), ...(x.address ? [x.address] : []), ...(x.taxId ? [`Steuernummer / USt-IdNr. (Tax number / VAT ID): ${x.taxId}`] : [])]
  const out = [
    draft.kind === 'invoice' ? 'Rechnung (Invoice)' : 'Quittung (Receipt)',
    ...(draft.job ? [`Auftrag (Job): #${draft.job.number} ${draft.job.title}`] : []),
    ...party('Von (From):', draft.issuer),
    ...party('An (To):', draft.recipient),
  ]
  for (const l of draft.lines) {
    out.push(`${KIND_LABEL[l.kind]}${l.kind !== 'job' && l.task ? ` ${l.task}` : ''}: ${l.description}, Leistungsdatum (Service date): ${date(l.serviceDate)}`)
    if (l.material) out.push(`  Arbeitskosten (Labour): ${m(l.labour)}, Material (Material): ${m(l.material)}`)
    out.push(vat ? `  Netto (Net): ${m(l.net)}, ${ust}: ${m(l.vat)}, Brutto (Gross): ${m(l.gross)}` : `  Betrag (Amount): ${m(l.gross)}`)
  }
  const tt = draft.totals
  out.push(vat ? `Summe netto (Total net): ${m(tt.net)}, ${ust}: ${m(tt.vat)}, Summe brutto (Total gross): ${m(tt.gross)}` : `Summe (Total): ${m(tt.gross)}`)
  if (tt.material) out.push(`Arbeitskosten (Labour): ${m(tt.labour)}, Material (Material): ${m(tt.material)}`)
  return [...out, ...draft.notes]
}
