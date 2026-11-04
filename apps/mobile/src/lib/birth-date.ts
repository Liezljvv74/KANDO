const pad = (n: number) => String(n).padStart(2, '0')

/** A picked day as YYYY-MM-DD in the phone's own time zone (toISOString would shift it by the offset). */
export const toIsoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** YYYY-MM-DD as a local date at noon (so a daylight-saving shift cannot move the day), or null when it is not a date. */
export function fromIsoDay(s: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? '')
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)
  return toIsoDay(d) === s ? d : null
}
