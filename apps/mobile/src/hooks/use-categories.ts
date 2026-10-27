import { useCallback, useEffect, useState } from 'react'

import type { Category } from '@kando/contract'

import { getCategories } from '@/api/providers'
import { ApiError } from '@/api/client'
import { getLang, useLang } from '@/i18n'

/** Active categories in the current language (cached per language). `names` maps slug to name. */
const cache: Partial<Record<string, Category[]>> = {}

export function useCategories() {
  const lang = useLang()
  const [list, setList] = useState<Category[] | null>(cache[lang] ?? null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => {
    const l = getLang()
    setError(null)
    getCategories(l)
      .then((c) => {
        cache[l] = c
        if (getLang() === l) setList(c)
      })
      .catch((e) => setError(e instanceof ApiError ? e.code : 'network'))
  }, [])
  useEffect(() => {
    setList(cache[lang] ?? null)
    if (!cache[lang]) load()
  }, [lang, load])
  const names = new Map((list ?? []).map((c) => [c.slug, c.name]))
  return { categories: list, names, error, retry: load }
}
