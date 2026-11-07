import { Linking } from 'react-native'

import { t as translate, type Lang } from '@kando/i18n/app'

import { getLang, SUPPORT_EMAIL } from '@/i18n'
import { isMailto } from '@/lib/safe-url'

/** The Contact support mail: only the job number and title are filled in, nothing personal. */
export function supportMailto(job: { number: number; title: string }, lang: Lang): string {
  const p = { number: job.number, title: job.title }
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(translate(lang, 'support.mailSubject', p))}&body=${encodeURIComponent(translate(lang, 'support.mailBody', p))}`
}

/** Opens the mail app with the support mail filled in (no screen of our own). */
export function openSupport(job: { number: number; title: string }): void {
  const url = supportMailto(job, getLang())
  if (isMailto(url)) Linking.openURL(url).catch(() => {})
}
