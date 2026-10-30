/** An amount typed by a person: digits with one optional decimal comma or dot and up to 2 decimals; null for anything else ("1e3", "1.250,50", "0"). */
export function parseAmount(s: string): number | null {
  const v = s.trim()
  if (!/^\d+([.,]\d{1,2})?$/.test(v)) return null
  const n = Number(v.replace(',', '.'))
  return n > 0 ? n : null
}

/** Like parseAmount, but 0 is allowed ("0", "0,00"): a stated stop amount or a material part may be nothing. */
export const parseAmountOrZero = (s: string): number | null => (/^0+([.,]0{1,2})?$/.test(s.trim()) ? 0 : parseAmount(s))
