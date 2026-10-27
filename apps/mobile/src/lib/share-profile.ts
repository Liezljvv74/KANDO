import { Share } from 'react-native'

import { DEFAULT_LANG, t, type Lang } from '@kando/i18n'

import { API_URL } from '@/api/client'

/** The website's provider page (same rule as the server's `providerUrl`); the language only when it is not the default. */
export const providerUrl = (slug: string, lang: Lang) => `${API_URL.replace(/\/$/, '')}/providers/${slug}${lang !== DEFAULT_LANG ? `?lang=${lang}` : ''}`

/** Opens the phone's share sheet with a short text in `lang` and the link. */
export const shareProfile = (url: string, lang: Lang) => Share.share({ message: t(lang, 'setup.shareText', { url }), url })
