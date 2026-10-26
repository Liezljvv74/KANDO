import type { Lang } from '@/i18n'
import { Select } from '@/components/select'
import { chooseLanguage } from '@/hooks/use-session'
import { t, useLang } from '@/i18n'

// Each language in its own words, so it is found whichever language is active.
const options: { value: Lang; label: string }[] = [
  { value: 'de', label: 'Deutsch' },
  { value: 'en', label: 'English' },
]

export function LanguageSwitch() {
  const lang = useLang()
  return <Select label={t('common.language')} options={options} value={lang} onChange={chooseLanguage} />
}
