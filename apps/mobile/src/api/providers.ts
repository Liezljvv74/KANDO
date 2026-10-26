import type { Category, ProviderDetail, SearchResult, TranslatableTexts } from '@kando/contract'

import { api } from '@/api/client'
import type { Lang } from '@/i18n'

export type SearchParams = { category?: string | null; postcode?: string; q?: string; page?: number }

/** Empty filters are left out; the text is trimmed. */
export function searchPath({ category, postcode, q, page = 1 }: SearchParams): string {
  const query = new URLSearchParams()
  if (category) query.set('category', category)
  if (postcode?.trim()) query.set('postcode', postcode.trim())
  if (q?.trim()) query.set('q', q.trim())
  query.set('page', String(page))
  return `/app-api/v1/providers?${query}`
}

export const searchProviders = (p: SearchParams) => api<SearchResult>(searchPath(p))
export const getProvider = (slug: string, lang: Lang) => api<ProviderDetail>(`/app-api/v1/providers/${encodeURIComponent(slug)}?lang=${lang}`)
export const getTranslation = (slug: string, lang: Lang) =>
  api<TranslatableTexts>(`/app-api/v1/providers/${encodeURIComponent(slug)}/translation?lang=${lang}`)
export const getCategories = (lang: Lang) => api<Category[]>(`/app-api/v1/categories?lang=${lang}`)

/** Only absolute http(s) URLs load; a server-relative URL would be an /api/* path the app must not call. */
export const photoSrc = (url: string | null) => (url && /^https?:\/\//i.test(url) ? url : null)
