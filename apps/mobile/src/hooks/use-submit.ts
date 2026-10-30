import { useState } from 'react'

import { ApiError } from '@/api/client'
import { errorText } from '@/i18n'

/** One server call from a button: `busy` while it runs, `problem` is the plain-words error; `then` runs only on success. */
export function useSubmit() {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  async function submit(call: () => Promise<unknown>, then?: () => void) {
    setBusy(true)
    setProblem(null)
    try {
      await call()
      then?.()
    } catch (e) {
      setProblem(errorText(e instanceof ApiError ? e.code : ''))
    }
    setBusy(false)
  }
  return { busy, problem, setProblem, submit }
}
