import { after } from 'next/server'
import type { Schedule } from '@kando/domain'

/** Runs the work after the response is sent (Next's after()); with no request scope (vitest calls routes directly) it runs now, awaited. */
export const afterResponse: Schedule = (work) => {
  try {
    after(work)
  } catch {
    return work()
  }
}
