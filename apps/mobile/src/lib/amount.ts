/** An amount typed by a person: digits with one optional decimal comma or dot and up to 2 decimals; null for anything else ("1e3", "1.250,50", "0"). */
export function parseAmount(s: string): number | null {
  const v = s.trim()
  if (!/^\d+([.,]\d{1,2})?$/.test(v)) return null
  const n = Number(v.replace(',', '.'))
  return n > 0 ? n : null
}

/** Like parseAmount, but 0 is allowed ("0", "0,00"): a stated stop amount or a material part may be nothing. */
export const parseAmountOrZero = (s: string): number | null => (/^0+([.,]0{1,2})?$/.test(s.trim()) ? 0 : parseAmount(s))

/** What the provider keeps of a typed amount at `rate` ("102.00" for 120 at 0.15); null while the text is no valid amount. Same rounding as the server (youReceive). */
export function receiveFrom(typed: string, rate: number): number | null {
  const v = parseAmount(typed)
  return v === null ? null : Math.round((v - Math.round(Number((v * 100 * rate).toPrecision(15))) / 100) * 100) / 100
}
