import { useState } from 'react'
import { Text } from 'react-native'

import { ApiError } from '@/api/client'
import { notifyMe, stopNotifyMe } from '@/api/payments'
import { ErrorText } from '@/components/auth-ui'
import { SmallButton } from '@/components/form-ui'
import { errorText, t } from '@/i18n'

/** Replaces Book and Request a quote on a provider that cannot be booked yet: a toggle for the "available" notice. */
export function NotifyMe({ slug }: { slug: string }) {
  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  async function toggle() {
    setBusy(true)
    setProblem(null)
    try {
      await (on ? stopNotifyMe(slug) : notifyMe(slug))
      setOn(!on)
    } catch (e) {
      setProblem(errorText(e instanceof ApiError ? e.code : ''))
    }
    setBusy(false)
  }
  return (
    <>
      <SmallButton label={t(on ? 'provider.notifyMeStop' : 'provider.notifyMe')} onPress={toggle} busy={busy} />
      {on && <Text>{t('provider.notifyMeOn')}</Text>}
      <ErrorText text={problem} />
    </>
  )
}
