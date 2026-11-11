import { useEffect, useMemo, useRef, useState } from 'react'

import type { Key } from '@/i18n'
import { errorText } from '@/i18n'
import { createOnce, runDone } from '@/lib/done-flow'
import { finishFlow } from '@/lib/finish-flow'
import { goToStep, loadNextStep } from '@/lib/flow-state'
import { goBack } from '@/lib/go'
import { missingMessage } from '@/lib/required-fields'

import { useFlash } from './use-flash'

const PAUSE_MS = 1000 // "Saved" stays visible this long before the screen changes

/** The Done button: checks what is missing, saves, shows "Saved", then goes back (plain edit), to the next open step, or ends the flow. */
export function useDone(cfg: { isProvider: boolean; missing: () => Key[]; commit: () => Promise<boolean> }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [saved, showSaved, hideSaved] = useFlash(PAUSE_MS + 500)
  const cfgRef = useRef(cfg)
  cfgRef.current = cfg
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      clearTimeout(timer.current)
    }
  }, [])

  const run = useMemo(
    () =>
      createOnce(async () => {
        setBusy(true)
        setMessage(null)
        hideSaved()
        const out = await runDone({ isProvider: cfgRef.current.isProvider, missing: () => cfgRef.current.missing(), commit: () => cfgRef.current.commit(), loadNext: loadNextStep })
        if (!alive.current) return // the person left while it ran: nothing more to show or open
        if (out.type === 'missing' || out.type === 'failed') {
          setBusy(false)
          return setMessage(out.type === 'missing' ? missingMessage(out.fields) : errorText(''))
        }
        showSaved() // lasts a little longer than the pause, so "Saved" is seen until the screen changes
        await new Promise<void>((resolve) => (timer.current = setTimeout(resolve, PAUSE_MS)))
        if (!alive.current) return
        try {
          if (out.type === 'edit') goBack()
          else if (out.type === 'next') await goToStep(out.step)
          else finishFlow(out.role)
        } finally {
          if (alive.current) setBusy(false)
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  // the data is saved: a failed move just leaves the person on the screen
  return { onDone: () => void run().catch(() => {}), busy, saved, message }
}
