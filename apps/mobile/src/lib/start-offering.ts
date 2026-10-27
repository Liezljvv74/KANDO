import { router } from 'expo-router'

import { ApiError } from '@/api/client'
import { ensureDraft } from '@/api/my-profile'
import { loadMe } from '@/hooks/use-me'
import { errorText } from '@/i18n'

let running: Promise<string | null> | null = null

/**
 * "Offer services": create the draft (idempotent, sets is_provider), reload /me so the My profile tab exists, then open the page.
 * Resolves to null, or the error text (no navigation). A tap while one runs shares that run.
 */
export function startOffering(welcome = false): Promise<string | null> {
  running ??= (async () => {
    try {
      await ensureDraft()
      await loadMe()
      router.navigate(welcome ? '/my-profile?welcome=1' : '/my-profile')
      return null
    } catch (e) {
      return errorText(e instanceof ApiError ? e.code : '')
    } finally {
      running = null
    }
  })()
  return running
}
