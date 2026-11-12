import { useFocusEffect } from 'expo-router'
import { useCallback, useRef, useState } from 'react'

import type { Key } from '@/i18n'
import { pressDone, pressGuard } from '@/lib/done-flow'
import { nextStepHeld, type Step } from '@/lib/flow-cache'
import { loadNextStep } from '@/lib/flow-state'
import { missingMessage } from '@/lib/required-fields'

/**
 * The Done button of the screen of `step`: shows what is missing, or sends the unsaved fields (`flush`, never awaited) and
 * opens the next screen at once from held data. The data is requested when the screen is shown (never awaited).
 */
export function useDone(cfg: { isProvider: boolean; step: Step; missing: () => Key[]; invalid?: () => string | null; flush: () => unknown }) {
  const [message, setMessage] = useState<string | null>(null)
  const cfgRef = useRef(cfg)
  cfgRef.current = cfg
  const wasOpen = useRef(true) // something was open when the screen was shown; unknown counts as open
  const [guard] = useState(() =>
    pressGuard(() => {
      const out = pressDone(cfgRef.current, wasOpen.current)
      if (out.type === 'missing') setMessage(missingMessage(out.fields))
      else if (out.type === 'invalid') setMessage(out.text)
      else setMessage(null)
      return out.type !== 'missing' && out.type !== 'invalid'
    }),
  )
  useFocusEffect(
    useCallback(() => {
      guard.reset()
      wasOpen.current = nextStepHeld() !== null
      loadNextStep().then((s) => void (wasOpen.current = s !== null), () => {})
    }, [guard]),
  )
  return { onDone: guard.press, message }
}
