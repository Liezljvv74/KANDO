'use client'

import { createContext, useContext } from 'react'
import { DEFAULT_LANG, t, type Key, type Lang } from '@kando/i18n'

const LangContext = createContext<Lang>(DEFAULT_LANG)

export const AdminLangProvider = LangContext.Provider
export const useAdminLang = () => useContext(LangContext)

/** Back office texts in the current language: const at = useAt(). */
export function useAt() {
  const lang = useAdminLang()
  return (key: Key, params?: Record<string, string | number>) => t(lang, key, params)
}
