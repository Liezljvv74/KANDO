import { getLang } from '@/i18n'

/** The device-local date ("2027-01-05") and time ("09:30") as an ISO instant; null when either is not a real date or time. */
export function toStartAt(date: string, time: string): string | null {
  const [d, t] = [date.trim(), time.trim()]
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{2}:\d{2}$/.test(t)) return null
  const at = new Date(`${d}T${t}:00`)
  if (Number.isNaN(at.getTime())) return null
  // "2027-02-31" rolls over to March: reject it instead of booking another day.
  const back = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}T${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
  return back === `${d}T${t}` ? at.toISOString() : null
}

/** Whole minutes from a text field; null when it is not a whole number (the server checks the range). */
export const toMinutes = (s: string): number | null => (/^\d{1,4}$/.test(s.trim()) ? Number(s.trim()) : null)

/** "5 Jan 2027, 09:30" in the app language. */
export const formatWhen = (iso: string): string => new Date(iso).toLocaleString(getLang(), { dateStyle: 'medium', timeStyle: 'short' })
export const formatDay = (iso: string): string => new Date(iso).toLocaleDateString(getLang(), { dateStyle: 'medium' })
