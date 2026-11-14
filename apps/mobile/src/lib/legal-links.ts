import { Linking } from 'react-native'

import { API_URL } from '@/api/client'
import { getLang, type Lang } from '@/i18n'

export type LegalSlug = 'agb' | 'datenschutz' | 'impressum'

/** The page staff publish on the website, in the given language (German is the default and has no query). */
export const legalUrl = (slug: LegalSlug, lang: Lang, base: string = API_URL) => `${base}/${slug}${lang === 'de' ? '' : '?lang=en'}`

/** Opens the page in the phone's browser, in the app's language. */
export const openLegal = (slug: LegalSlug) => Linking.openURL(legalUrl(slug, getLang())).catch(() => {})
