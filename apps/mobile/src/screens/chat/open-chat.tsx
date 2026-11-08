import { useRef, useState } from 'react'

import { ApiError } from '@/api/client'
import { ErrorText } from '@/components/auth-ui'
import { SmallButton } from '@/components/form-ui'
import { errorText } from '@/i18n'
import { chatLabel } from '@/lib/chat-label'
import { go } from '@/lib/go'

/** "Open chat": `find` gives the thread id (or null when there is none), then the conversation opens. */
export function OpenChat({ find, grow, unread }: { find: () => Promise<string | null>; grow?: boolean; unread?: number }) {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const working = useRef(false)
  async function open() {
    if (working.current) return
    working.current = true
    setBusy(true)
    setProblem(null)
    try {
      const id = await find()
      if (id) go(`/threads/${id}`)
      else setProblem(errorText('Not found'))
    } catch (e) {
      setProblem(errorText(e instanceof ApiError ? e.code : 'network'))
    }
    working.current = false
    setBusy(false)
  }
  return (
    <>
      <SmallButton label={chatLabel(unread)} onPress={open} busy={busy} grow={grow} />
      <ErrorText text={problem} />
    </>
  )
}
