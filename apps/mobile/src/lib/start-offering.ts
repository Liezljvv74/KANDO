import { ApiError } from '@/api/client'
import { ensureDraft } from '@/api/my-profile'
import { loadMe } from '@/hooks/use-me'
import { errorText } from '@/i18n'
import { setPending } from '@/lib/pending-navigation'

let running: Promise<string | null> | null = null

/**
 * "Offer services": create the draft (idempotent, sets is_provider), reload /me so the My profile tab exists, then hand the target to the tabs layout, which opens the page once the tab is rendered.
 * Resolves to null, or the error text (no navigation). A tap while one runs shares that run.
 */
export function startOffering(welcome = false): Promise<string | null> {
  running ??= (async () => {
    try {
      await ensureDraft()
      await loadMe()
      setPending({ path: '/my-profile', welcome }) // the tabs layout navigates once the tab is visible
      return null
    } catch (e) {
      return errorText(e instanceof ApiError ? e.code : '')
    } finally {
      running = null
    }
  })()
  return running
}
