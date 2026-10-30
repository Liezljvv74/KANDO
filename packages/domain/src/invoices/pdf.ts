import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib'
import { TIME_ZONE } from '@kando/i18n'
import { invoiceLines, type InvoiceDraft } from './build'

export const TEST_WATERMARK = 'TESTDOKUMENT / TEST DOCUMENT'

const A4: [number, number] = [595.28, 841.89]
const MARGIN = 50
const SIZE = 10
const LEADING = 14

// Letters the standard fonts (WinAnsi) lack, with a plain stand-in; accents are dropped by NFD first, anything else is '?'.
const STAND_IN: Record<string, string> = { Ł: 'L', ł: 'l', Đ: 'D', đ: 'd', Ø: 'O', ø: 'o', ı: 'i', Ħ: 'H', ħ: 'h', '−': '-', '‐': '-', '‑': '-', ' ': ' ', ' ': ' ', ' ': ' ', '\t': ' ' }

/**
 * Text the standard Helvetica can draw: every character it cannot encode becomes its accent-free letter, a stand-in, or
 * '?', so no name (emoji, Polish, Greek ...) can make the PDF fail. German letters and the euro sign are kept.
 */
export function pdfSafe(text: string, font: PDFFont): string {
  const ok = (s: string) => {
    try {
      font.encodeText(s)
      return true
    } catch {
      return false
    }
  }
  let out = ''
  for (const ch of text.normalize('NFC')) {
    if (ok(ch)) out += ch
    else {
      const alt = STAND_IN[ch] ?? ch.normalize('NFD').replace(/\p{M}/gu, '')
      out += alt && ok(alt) ? alt : '?'
    }
  }
  return out
}

/** Splits one line into lines that fit `width` (by words; a word longer than the width is cut). */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const fits = (s: string) => font.widthOfTextAtSize(s, size) <= width
  const out: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word
    if (fits(next)) {
      line = next
      continue
    }
    if (line) out.push(line)
    line = ''
    let rest = word
    while (!fits(rest)) {
      let n = rest.length - 1
      while (n > 1 && !fits(rest.slice(0, n))) n--
      out.push(rest.slice(0, n))
      rest = rest.slice(n)
    }
    line = rest
  }
  out.push(line)
  return out
}

const dateDe = (d: Date) => d.toLocaleDateString('de-DE', { timeZone: TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric' })

/**
 * The invoice or receipt as a PDF: A4, Helvetica, the lines of `invoiceLines` (German labels, English in brackets) under the
 * number and the date of issue, as many pages as the lines need. `test` (payments not live) puts "TESTDOKUMENT / TEST
 * DOCUMENT" on every page. The dates in the file are the issue date, so a re-render of the same invoice is the same document.
 */
export async function renderPdf(draft: InvoiceDraft, number: string, issuedAt: Date, test: boolean): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  doc.setTitle(pdfSafe(number, font))
  doc.setCreationDate(issuedAt)
  doc.setModificationDate(issuedAt)

  const [title, ...body] = invoiceLines(draft, 'de')
  const rows: { text: string; font: PDFFont; size: number }[] = [
    { text: title!, font: bold, size: 16 },
    { text: `Nummer (Number): ${number}`, font: bold, size: SIZE },
    { text: `Ausstellungsdatum (Date of issue): ${dateDe(issuedAt)}`, font, size: SIZE },
    { text: '', font, size: SIZE },
    ...body.flatMap((l) => l.split(/\r?\n/)).map((text) => ({ text, font, size: SIZE })),
  ]

  const width = A4[0] - 2 * MARGIN
  let page: PDFPage | undefined
  let y = 0
  const newPage = () => {
    page = doc.addPage(A4)
    y = A4[1] - MARGIN
    if (test) {
      page.drawText(TEST_WATERMARK, { x: 90, y: 250, size: 36, font: bold, color: rgb(0.85, 0.2, 0.2), opacity: 0.25, rotate: degrees(45) })
      page.drawText(TEST_WATERMARK, { x: MARGIN, y: MARGIN / 2, size: 9, font: bold, color: rgb(0.8, 0.1, 0.1) })
    }
  }
  newPage()
  for (const r of rows) {
    const indent = r.text.match(/^ */)![0].length * 3
    for (const line of wrap(pdfSafe(r.text.trimStart(), r.font), r.font, r.size, width - indent)) {
      const lead = r.size > SIZE ? r.size + 6 : LEADING
      if (y - lead < MARGIN) newPage()
      y -= lead
      page!.drawText(line, { x: MARGIN + indent, y, size: r.size, font: r.font, color: rgb(0, 0, 0) })
    }
  }
  return doc.save()
}
