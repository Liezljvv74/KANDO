// Made-up test documents for the AI document check evaluation (MVP plan step 2.6). Everything is drawn here, locally, with
// fictional names and numbers; no real person, no real document, no network. Each one carries the verdict a careful person would give.
import sharp from 'sharp'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

export type Fixture = {
  id: string
  /** A requirement code from DOCUMENT_TYPES. */
  type: string
  /** The names the checker is told the document may carry (the account holder). */
  names: string[]
  expected: 'ok' | 'problem'
  why: string
  render: () => Promise<{ bytes: Buffer; mime: string }>
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const date = (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`
const years = (n: number) => {
  const d = new Date()
  d.setUTCFullYear(d.getUTCFullYear() + n)
  return d
}
const FOOTER = 'Fictional sample for software testing'

const svgToPng = (svg: string) => sharp(Buffer.from(svg)).png().toBuffer()
const wrap = (w: number, h: number, body: string, bg = '#f4f1e8') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${bg}"/>${body}<text x="20" y="${h - 14}" font-family="sans-serif" font-size="13" fill="#777">${FOOTER}</text></svg>`
const line = (x: number, y: number, text: string, size = 26, weight = 'normal', fill = '#222') =>
  `<text x="${x}" y="${y}" font-family="sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}">${esc(text)}</text>`

/** A card-like photo ID. */
function idCard(o: { name: string; number: string; birth: string; validUntil: Date; kind?: string }) {
  const body =
    `<rect x="20" y="20" width="860" height="520" rx="28" fill="#dbe8f4" stroke="#4a6a8a" stroke-width="4"/>` +
    line(50, 80, o.kind ?? 'IDENTITY CARD', 34, 'bold', '#16324f') +
    `<rect x="50" y="120" width="220" height="280" fill="#9bb3c9"/><circle cx="160" cy="220" r="55" fill="#6f8aa3"/><rect x="100" y="290" width="120" height="110" rx="40" fill="#6f8aa3"/>` +
    line(310, 160, 'Surname / Given name', 16, 'normal', '#556') +
    line(310, 200, o.name, 34, 'bold') +
    line(310, 250, 'Date of birth', 16, 'normal', '#556') +
    line(310, 285, o.birth, 28) +
    line(310, 335, 'Document number', 16, 'normal', '#556') +
    line(310, 370, o.number, 28) +
    line(310, 420, 'Valid until', 16, 'normal', '#556') +
    line(310, 455, date(o.validUntil), 28)
  return wrap(900, 560, body, '#e9eef3')
}

/** A certificate (insurance, registration, qualification) with an optional validity date. */
function certificate(o: { title: string; holder: string; issuer: string; number: string; validUntil?: Date; extra?: string }) {
  const body =
    `<rect x="30" y="30" width="840" height="1040" fill="#fffdf7" stroke="#8a7a4a" stroke-width="6"/>` +
    line(80, 130, o.issuer, 30, 'bold', '#5a4a1a') +
    line(80, 220, o.title, 44, 'bold') +
    line(80, 330, 'This is to certify that', 22, 'normal', '#555') +
    line(80, 390, o.holder, 40, 'bold') +
    line(80, 470, o.extra ?? 'fulfils the requirements for the activity named in this document.', 22) +
    line(80, 560, `Certificate number: ${o.number}`, 24) +
    line(80, 610, `Issued: ${date(years(-2))}`, 24) +
    (o.validUntil ? line(80, 660, `Valid until: ${date(o.validUntil)}`, 24) : '') +
    line(80, 900, 'Stamp and signature', 20, 'normal', '#777')
  return wrap(900, 1100, body, '#ffffff')
}

const bill = (name: string) =>
  wrap(
    900,
    1100,
    line(80, 120, 'City Power & Water', 40, 'bold') + line(80, 220, 'Invoice for electricity', 32) + line(80, 300, `Customer: ${name}`, 26) + line(80, 360, 'Amount due: 84.30 EUR', 26) + line(80, 420, `Due date: ${date(years(0))}`, 26),
    '#ffffff',
  )
const recipe = () =>
  wrap(900, 700, line(60, 120, 'Pancakes', 48, 'bold') + line(60, 200, '2 eggs, 250 g flour, 500 ml milk, a pinch of salt', 26) + line(60, 260, 'Whisk, rest for 20 minutes, fry in a hot pan.', 26), '#fff6e0')

async function pdf(lines: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([595, 842])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  lines.forEach((t, i) => page.drawText(t, { x: 50, y: 760 - i * 34, size: i === 1 ? 22 : 14, font: i === 1 ? bold : font, color: rgb(0.1, 0.1, 0.1) }))
  page.drawText(FOOTER, { x: 50, y: 30, size: 9, font, color: rgb(0.5, 0.5, 0.5) })
  return Buffer.from(await doc.save())
}

const png = (make: () => Promise<Buffer> | Buffer) => async () => ({ bytes: await make(), mime: 'image/png' })
const pdfOf = (lines: string[]) => async () => ({ bytes: await pdf(lines), mime: 'application/pdf' })

const ID = 'id-document'
const INS = 'liability-insurance'

/** About twenty made-up documents: eight that are fine, twelve with one clear problem each. */
export function fixtures(): Fixture[] {
  const ok = (id: string, type: string, names: string[], why: string, render: Fixture['render']): Fixture => ({ id, type, names, expected: 'ok', why, render })
  const bad = (id: string, type: string, names: string[], why: string, render: Fixture['render']): Fixture => ({ id, type, names, expected: 'problem', why, render })
  const idImg = (o: Parameters<typeof idCard>[0]) => svgToPng(idCard(o))
  const cert = (o: Parameters<typeof certificate>[0]) => svgToPng(certificate(o))
  return [
    ok('id-ok-1', ID, ['Maria Beispiel'], 'valid ID card', png(() => idImg({ name: 'Beispiel, Maria', number: 'T22000129', birth: '12.03.1988', validUntil: years(4) }))),
    ok('id-ok-2', ID, ['Jonas Testmann'], 'valid ID card, given name first', png(() => idImg({ name: 'Jonas Testmann', number: 'L01X00T47', birth: '30.11.1979', validUntil: years(2) }))),
    ok('id-ok-3', ID, ['Lena Muster'], 'valid passport layout', png(() => idImg({ name: 'MUSTER LENA', number: 'C01X00T58', birth: '05.07.1995', validUntil: years(7), kind: 'PASSPORT' }))),
    ok('ins-ok-1', INS, ['Ahmet Probe'], 'valid liability insurance, PDF', pdfOf(['Insurance certificate', 'Liability insurance', 'Holder: Ahmet Probe', 'Insurer: Fiktiv Versicherung AG', 'Policy number: FV-2026-448812', `Valid until: ${date(years(1))}`])),
    ok('ins-ok-2', INS, ['Sophie Fiktiv'], 'valid liability insurance, image', png(() => cert({ title: 'Liability insurance', holder: 'Sophie Fiktiv', issuer: 'Muster Versicherung', number: 'MV-88-1204', validUntil: years(1) }))),
    ok('trade-ok-1', 'trade-registration', ['Tomas Demo'], 'valid trade registration, no end date', pdfOf(['Trade registration', 'Gewerbeanmeldung', 'Trader: Tomas Demo', 'Authority: Stadt Beispielhausen', 'Registration number: GW-2022-0713'])),
    ok('craft-ok-1', 'craft-qualification', ['Maria Beispiel'], 'valid qualification, no expiry date', png(() => cert({ title: 'Master craftsperson certificate', holder: 'Maria Beispiel', issuer: 'Chamber of Crafts (fictional)', number: 'HWK-1999-77', extra: 'has passed the master examination.' }))),
    ok('firstaid-ok-1', 'first-aid-certificate', ['Jonas Testmann'], 'valid first aid certificate', png(() => cert({ title: 'First aid course', holder: 'Jonas Testmann', issuer: 'Rescue Training Centre (fictional)', number: 'EH-5521', validUntil: years(1) }))),

    bad('id-name-1', ID, ['Maria Beispiel'], 'name does not match the account', png(() => idImg({ name: 'Beispiel, Marta', number: 'T22000130', birth: '12.03.1988', validUntil: years(4) }))),
    bad('id-expired-1', ID, ['Jonas Testmann'], 'ID expired', png(() => idImg({ name: 'Jonas Testmann', number: 'L01X00T50', birth: '30.11.1979', validUntil: years(-1) }))),
    bad('id-wrongtype-1', ID, ['Lena Muster'], 'an electricity bill instead of an ID', png(() => svgToPng(bill('Lena Muster')))),
    bad('id-blur-1', ID, ['Maria Beispiel'], 'unreadable (heavy blur)', png(async () => sharp(await idImg({ name: 'Beispiel, Maria', number: 'T22000131', birth: '12.03.1988', validUntil: years(4) })).blur(28).modulate({ brightness: 0.5 }).png().toBuffer())),
    bad('id-cropped-1', ID, ['Jonas Testmann'], 'cropped: the name and the validity date are cut off', png(async () => sharp(await idImg({ name: 'Jonas Testmann', number: 'L01X00T51', birth: '30.11.1979', validUntil: years(3) })).extract({ left: 0, top: 0, width: 300, height: 560 }).png().toBuffer())),
    bad('ins-name-1', INS, ['Ahmet Probe'], 'insurance is for another person', pdfOf(['Insurance certificate', 'Liability insurance', 'Holder: Burak Fremd', 'Insurer: Fiktiv Versicherung AG', 'Policy number: FV-2026-448899', `Valid until: ${date(years(1))}`])),
    bad('ins-expired-1', INS, ['Sophie Fiktiv'], 'insurance expired', png(() => cert({ title: 'Liability insurance', holder: 'Sophie Fiktiv', issuer: 'Muster Versicherung', number: 'MV-88-0001', validUntil: years(-1) }))),
    bad('ins-wrongtype-1', INS, ['Tomas Demo'], 'a recipe instead of an insurance certificate', png(() => svgToPng(recipe()))),
    bad('trade-name-1', 'trade-registration', ['Tomas Demo'], 'registration of another trader', pdfOf(['Trade registration', 'Gewerbeanmeldung', 'Trader: Thomas Andere', 'Authority: Stadt Beispielhausen', 'Registration number: GW-2022-0999'])),
    bad('craft-wrongtype-1', 'craft-qualification', ['Maria Beispiel'], 'an electricity bill instead of a qualification', png(() => svgToPng(bill('Maria Beispiel')))),
    bad('firstaid-expired-1', 'first-aid-certificate', ['Jonas Testmann'], 'first aid certificate expired', png(() => cert({ title: 'First aid course', holder: 'Jonas Testmann', issuer: 'Rescue Training Centre (fictional)', number: 'EH-0100', validUntil: years(-2) }))),
    bad('id-noise-1', ID, ['Lena Muster'], 'unreadable (almost black photo)', png(() => sharp({ create: { width: 900, height: 560, channels: 3, background: '#0b0b0b' } }).png().toBuffer())),
  ]
}
