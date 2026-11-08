import { Alert, Linking } from 'react-native'

import { t as translate, type AppKey, type Lang } from '@kando/i18n/app'

import { getLang, SUPPORT_EMAIL, t } from '@/i18n'
import { isMailto } from '@/lib/safe-url'

type SupportJob = { number?: number; title?: string }

/** The Contact support mail: only the job number and title are filled in (each only when there is one), nothing personal. */
export function supportMailto(job: SupportJob, lang: Lang): string {
  const n = job.number && job.number > 0 ? job.number : undefined
  const kind = n === undefined ? 'Plain' : job.title ? '' : 'Number'
  const p = { number: n ?? '', title: job.title ?? '' }
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(translate(lang, `support.mailSubject${kind}` as AppKey, p))}&body=${encodeURIComponent(translate(lang, `support.mailBody${kind}` as AppKey, p))}`
}

/** Opens the mail app with the support mail filled in; without a mail app the person is shown the address. */
export function openSupport(job: SupportJob): void {
  const url = supportMailto(job, getLang())
  const showAddress = () => Alert.alert(t('support.noMailTitle'), t('support.noMailBody'))
  if (!isMailto(url)) return showAddress()
  Linking.openURL(url).catch(showAddress)
}
