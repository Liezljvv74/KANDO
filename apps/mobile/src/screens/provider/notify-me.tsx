import { useState } from 'react'
import { Text } from 'react-native'

import { notifyMe, stopNotifyMe } from '@/api/payments'
import { ErrorText } from '@/components/auth-ui'
import { SmallButton } from '@/components/form-ui'
import { errorText, t } from '@/i18n'
import { useMe } from '@/hooks/use-me'
import { paymentsOff, paymentsProblem } from '@/lib/payments-off'

/** Replaces Book and Request a quote on a provider that cannot be booked yet: a toggle for the "available" notice. */
export function NotifyMe({ slug, watching }: { slug: string; watching: boolean }) {
  const me = useMe()
  const [on, setOn] = useState(watching)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  async function toggle() {
    setBusy(true)
    setProblem(null)
    try {
      await (on ? stopNotifyMe(slug) : notifyMe(slug))
      setOn(!on)
    } catch (e) {
      setProblem(paymentsProblem(e))
    }
    setBusy(false)
  }
  if (paymentsOff(me)) return <Text>{errorText('PAYMENTS_OFF')}</Text>
  return (
    <>
      <SmallButton label={t(on ? 'provider.notifyMeStop' : 'provider.notifyMe')} onPress={toggle} busy={busy} />
      {on && <Text>{t('provider.notifyMeOn')}</Text>}
      <ErrorText text={problem} />
    </>
  )
}
