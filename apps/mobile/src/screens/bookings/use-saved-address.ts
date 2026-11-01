import { useEffect, useRef } from 'react'

import { useMe } from '@/hooks/use-me'
import type { WhenWhere } from '@/lib/when-where'

/**
 * Starts the address fields from the saved account address, ONCE and only while they are still empty: a person who clears them
 * on purpose (the job is somewhere else) is not given the saved address back when the account data reloads.
 */
export function useSavedAddress(update: (change: (w: WhenWhere) => WhenWhere) => void) {
  const me = useMe()
  const done = useRef(false)
  useEffect(() => {
    const a = me?.address
    if (!a || done.current) return
    done.current = true
    update((w) => (w.address.postcode || w.address.street || w.address.city ? w : { ...w, address: { street: a.street ?? '', postcode: a.postcode, city: a.city ?? '' } }))
  }, [me, update])
}
