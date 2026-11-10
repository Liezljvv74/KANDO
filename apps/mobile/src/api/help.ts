import type { HelpTopic } from '@kando/contract'

import { api } from '@/api/client'
import type { Lang } from '@/i18n'

/** The approved Help topics in `lang`, in the server's order. Signed out works too. */
export const getHelpTopics = (lang: Lang) => api<HelpTopic[]>(`/app-api/v1/help?lang=${lang}`)

/** The approved topics that match `q` (keyword and meaning), at most 6, in the language `lang`. Signed out works too. */
export const searchHelpTopics = async (q: string, lang: Lang) => (await api<{ topics: HelpTopic[] }>(`/app-api/v1/help/search?q=${encodeURIComponent(q)}&lang=${lang}`)).topics
