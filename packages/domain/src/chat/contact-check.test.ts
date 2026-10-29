import { describe, expect, it } from 'vitest'
import { checkContactDetails, findContactDetails, type ContactHit } from './contact-check'

const rows: [string, ContactHit | null][] = [
  // brief table: blocked
  ['Ruf mich an: 0151 23456789', 'phone'],
  ['0 1 5 1 2 3 4 5 6 7 8 9', 'phone'],
  ['+49 30 1234567', 'phone'],
  ['0049-30-123-4567', 'phone'],
  ['(030) 123 45 67', 'phone'],
  ['null eins fünf eins zwei drei vier fünf sechs sieben acht', 'phone'],
  ['zero one five one two three four five six seven eight', 'phone'],
  ['null eins 5 eins 2345678', 'phone'],
  ['max@example.de', 'email'],
  ['max (at) example punkt de', 'email'],
  ['max at gmail dot com', 'email'],
  ['www.example.de', 'link'],
  ['www . example . de', 'link'],
  ['www .meinshop', 'link'],
  ['schau auf meinladen.shop', 'link'],
  ['hier: handwerk.berlin', 'link'],
  ['mein.store oder mein.online', 'link'],
  ['seite.xyz', 'link'],
  ['site.page und x.link', 'link'],
  ['https://wa.me/49151', 'link'],
  ['schreib mir auf example.com', 'link'],
  // brief table: allowed
  ['Das kostet 1.250,00 €', null],
  ['Preis: 85 EUR pro Stunde, 3 Stunden', null],
  ['Hauptstraße 12, 10115 Berlin', null],
  ['Hauptstraße 123a, 01067 Dresden', null],
  ['Am 29.10.2026 um 10:30 Uhr', null],
  ['Ich komme um 10.30 Uhr, ca. 2 Stunden', null],
  ['Ich habe eine Frage zu einem Termin', null],
  ['One more thing: bring two ladders', null],
  ['Wohnung im 3. Stock, Tür 12', null],
  ['Auftrag Nr. 4711', null],
  ['We meet at home at 5', null],
  ['z.B. am Montag, usw.', null],
  ['Größe 120 x 80 cm', null],
  ['Ich bin um 9 da, Postleitzahl 10115', null],

  // evasions: number words, mixed languages, digits split by words
  ['zero fünf null eins fünf eins zwei drei vier fünf sechs', 'phone'],
  ['zero 1 fünf eins two 3 four 5 sechs', 'phone'],
  ['null eins fünf eins zwo drei vier fuenf sechs sieben', 'phone'],
  ['null-eins-fünf-eins-zwei-drei-vier-fünf-sechs-sieben', 'phone'],
  ['oh one five one 2 3 4 5 6 7 8', 'phone'],
  ['plus vier neun drei null eins zwei drei vier fünf sechs', 'phone'],
  ['plus 49 30 1234567', 'phone'],
  ['PLUS vier neun 30 1234567', 'phone'],
  // evasions: separators
  ['0.1.5.1.2.3.4.5.6.7.8', 'phone'],
  ['0151-2345-6789', 'phone'],
  ['0151/23456789', 'phone'],
  ['0151_2345_6789', 'phone'],
  ['0151 . 2345 . 6789', 'phone'],
  ['0151.234.5678', 'phone'],
  ['(0151) 2345 6789', 'phone'],
  ['00 49 151 2345678', 'phone'],
  ['4915123456789', 'phone'],
  // evasions: full-width digits
  ['０１５１ ２３４５６７８９', 'phone'],
  // evasions: in the middle of a sentence / with messenger names
  ['Meld dich bitte unter 0151 23456789 danach, danke', 'phone'],
  ['whatsapp 0151 23456789', 'phone'],
  ['Telegram: +49 151 2345678 oder signal', 'phone'],
  ['Am 29.10.2026 um 10:30 Uhr, ruf 0151 23456789 an', 'phone'],
  // evasions: emails
  ['max ät example punkt de', 'email'],
  ['max [at] example [dot] de', 'email'],
  ['max(at)example(dot)de', 'email'],
  ['max (at) example . de', 'email'],
  ['max at gmail punkt com', 'email'],
  ['MAX AT GMAIL DOT COM', 'email'],
  ['max @ gmail dot com', 'email'],
  ['max.mustermann+kando@mail.example.org', 'email'],
  ['max ät web punkt de', 'email'],
  // evasions: links without scheme
  ['example dot com', 'link'],
  ['example punkt de', 'link'],
  ['example [dot] com', 'link'],
  ['example(punkt)net', 'link'],
  ['WWW.Example.DE', 'link'],
  ['http://x', 'link'],
  ['t.me/max', 'link'],
  ['meine seite: shop.example.ch/kontakt', 'link'],

  // invisible characters, keycap emoji, unicode dashes, pictographs, commas between number words
  ['0\u200b1\u200b5\u200b1 23456789', 'phone'],
  ['0151\u00ad2345\ufeff6789', 'phone'],
  ['0\ufe0f\u20e31\ufe0f\u20e35\ufe0f\u20e31\ufe0f\u20e32\ufe0f\u20e33\ufe0f\u20e34\ufe0f\u20e35\ufe0f\u20e36\ufe0f\u20e37\ufe0f\u20e38\ufe0f\u20e3', 'phone'],
  ['0151\u20132345\u20146789', 'phone'],
  ['0151\u22122345\u22126789', 'phone'],
  ['0\u{1F600}1\u{1F600}5\u{1F600}1\u{1F600}2\u{1F600}3\u{1F600}4\u{1F600}5\u{1F600}6\u{1F600}7\u{1F600}8', 'phone'],
  ['null, eins, fünf, eins, zwei, drei, vier, fünf, sechs, sieben', 'phone'],
  ['zero one five one, two three four five six seven eight', 'phone'],
  ['2026-10-29-1234567', 'phone'],
  // allowed: commas between digits, ISO dates
  ['Es dauert 1,5 Stunden', null],
  ['Ich brauche 3, 4, 5 Stunden', null],
  ['Auftrag Nr. 2026-10-29-001', null],
  ['Termin am 2026-10-29', null],
  ['eins, zwei, drei Uhr', null],
  // allowed stays allowed
  ['Preis 1.250,00 EUR inkl. MwSt', null],
  ['Das macht 85 Euro pro Stunde', null],
  ['Kostet € 1.250,50 oder EUR 99', null],
  ['Es sind 12.500 € dazu 3,5 Stunden', null],
  ['Am 29.10.26 passt es, dann 10:30', null],
  ['Ab 10.30 Uhr und bis 12.00 Uhr', null],
  ['Hauptstraße 12 10115 Berlin', null],
  ['Bestellung Nr. 4711 vom 01.02.2026', null],
  ['Maße 120 x 80 x 45 cm, 2,5 m lang', null],
  ['z.B. Fliesen, Farbe usw.', null],
  ['Der Platz ist frei, ein Termin passt', null],
  ['Eins nach dem anderen', null],
  ['one more thing', null],
  ['Ich komme at five, we meet at home. Then we talk.', null],
  ['a dot on the i, punkt acht Uhr', null],
  ['example dot party', null],
  ['Wir brauchen 3 bis 4 Tage, 2 Helfer', null],
  ['', null],
  ['   \n\t  ', null],
  ['Super 👍😀', null],
]

describe('findContactDetails', () => {
  it.each(rows)('%j -> %s', (text, expected) => {
    expect(findContactDetails(text)).toBe(expected)
  })

  it('never throws on odd input', () => {
    const odd = ['', '\u0000', '\n\r\t', '😀'.repeat(100), '\ud800', 'a\u0301'.repeat(50), '\u202e0151', '@', '(', '+', '.']
    for (const s of odd) expect(() => findContactDetails(s)).not.toThrow()
  })

  it('stays fast on 50,000-character inputs (no catastrophic backtracking)', () => {
    const inputs = [
      'a'.repeat(50000),
      '1'.repeat(50000),
      '1 '.repeat(25000),
      'a '.repeat(25000),
      'a@'.repeat(25000),
      'x at x dot '.repeat(4500),
      'x (at) x '.repeat(5500),
      'zero '.repeat(10000),
      'eins-'.repeat(10000),
      '1.'.repeat(25000),
      '. '.repeat(25000),
      '('.repeat(50000),
      'a.'.repeat(25000),
      '€ '.repeat(25000),
      '1.000'.repeat(10000),
      'eins, '.repeat(8000),
      '1,'.repeat(25000),
      '0\u{1F600}1'.repeat(15000),
      '\u200b'.repeat(50000),
      '0\ufe0f\u20e3'.repeat(15000),
      '2026-10-29-'.repeat(4500),
    ]
    for (const s of inputs) {
      const start = performance.now()
      findContactDetails(s)
      expect(performance.now() - start).toBeLessThan(200)
    }
  })
})

describe('checkContactDetails', () => {
  it('gives the same answer as the synchronous rules', async () => {
    expect(await checkContactDetails('max@example.de')).toBe('email')
    expect(await checkContactDetails('Auftrag Nr. 4711')).toBeNull()
  })
})
