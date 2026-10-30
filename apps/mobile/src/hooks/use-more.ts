import { useState } from 'react'

import type { Page } from '@kando/contract'

import { useSubmit } from '@/hooks/use-submit'

/**
 * "Show more" for a paged list: `first` is the first page (from useLoad); the pages fetched after it are added below.
 * A new first page (a reload) starts over. A row seen already is not added twice (a thread with a new message moves up the list).
 */
export function useMore<T extends { id: string }>(first: Page<T> | undefined, load: (cursor: string) => Promise<Page<T>>) {
  const [more, setMore] = useState<{ after: Page<T>; page: Page<T> }>()
  const page = more && more.after === first ? more.page : first
  const { busy, problem, submit } = useSubmit()
  const showMore = () => {
    if (!first || !page?.next || busy) return
    const next = page.next
    submit(async () => {
      const p = await load(next)
      const seen = new Set(page.docs.map((d) => d.id))
      setMore({ after: first, page: { docs: [...page.docs, ...p.docs.filter((d) => !seen.has(d.id))], next: p.next } })
    })
  }
  return { docs: page?.docs ?? [], next: page?.next ?? null, showMore, busy, problem }
}
