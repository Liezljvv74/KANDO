import { useEffect, useState } from 'react'

import type { ProviderDetail } from '@kando/contract'

import { getMyProfile } from '@/api/my-profile'
import { SmallButton } from '@/components/form-ui'
import { useMe } from '@/hooks/use-me'
import { t } from '@/i18n'
import { go } from '@/lib/go'
import { requestTarget } from '@/lib/request-target'

/** False on the person's own profile (and until that is known): nobody books themselves. The server refuses it too. */
export function useCanRequest(slug: string): boolean {
  const me = useMe()
  const [ownSlug, setOwnSlug] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    if (!me) return
    if (!me.isProvider) return setOwnSlug(null)
    getMyProfile().then((p) => setOwnSlug(p?.slug ?? null), () => setOwnSlug(undefined))
  }, [me])
  return !!me && ownSlug !== undefined && ownSlug !== slug
}

type Service = ProviderDetail['services'][number]

/** "Book" for a fixed-price service, "Request a quote" for the others (`service` left out: a general request). */
export function RequestButton({ provider, service }: { provider: ProviderDetail; service?: Service }) {
  const target = requestTarget(provider, service)
  if (!target) return null
  return <SmallButton label={t(target.book ? 'booking.book' : 'booking.requestQuote')} onPress={() => go(target.path, target.params)} />
}
