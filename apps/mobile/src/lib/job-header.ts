import { t, type Lang } from '@kando/i18n/app'

/** What the header reads: the job's number and other party (request DTO), and the time and place (the current booking, else the request's wish). */
export type HeaderJob = {
  jobNumber?: number
  otherParty?: string
  startAt: string | null
  durationMin: number | null
  onSite: boolean | null
  address: { postcode: string; city?: string } | null
}

const DASH = '–'

/** `Sat 14 Nov '26`; German numeric `25.11.'26`. Local time of the phone. */
export function headerDate(iso: string, lang: Lang): string {
  const d = new Date(iso)
  const yy = `'${String(d.getFullYear()).slice(-2)}`
  if (lang === 'de') return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${yy}`
  const part = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', o).format(d)
  return `${part({ weekday: 'short' })} ${d.getDate()} ${part({ month: 'short' })} ${yy}`
}

/** `14:00` in both languages (24 hours, short enough for one line). */
const headerTime = (iso: string) => {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * The six header cells in spec order (4.3): Job #, the OTHER party's role (the provider sees "Customer"), Date, Time, Duration,
 * Location (postcode and city, "Remote" for remote work). A value that is not known yet shows "–".
 */
export function headerCells(job: HeaderJob, viewer: 'customer' | 'provider', lang: Lang): Array<{ label: string; value: string }> {
  const at = job.startAt
  const place = job.onSite === false ? t(lang, 'booking.remote') : [job.address?.postcode, job.address?.city].filter(Boolean).join(' ')
  return [
    { label: t(lang, 'job.header.number'), value: job.jobNumber === undefined ? DASH : String(job.jobNumber) },
    { label: t(lang, viewer === 'provider' ? 'job.header.customer' : 'job.header.provider'), value: job.otherParty || DASH },
    { label: t(lang, 'job.header.date'), value: at ? headerDate(at, lang) : DASH },
    { label: t(lang, 'job.header.time'), value: at ? headerTime(at) : DASH },
    { label: t(lang, 'job.header.duration'), value: job.durationMin ? t(lang, 'job.header.minutes', { n: job.durationMin }) : DASH },
    { label: t(lang, 'job.header.location'), value: place || DASH },
  ]
}
