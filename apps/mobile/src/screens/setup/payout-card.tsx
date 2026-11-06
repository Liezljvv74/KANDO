import * as WebBrowser from 'expo-web-browser'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text } from 'react-native'

import type { MyProfile } from '@kando/contract'

import { saveMyProfile } from '@/api/my-profile'
import { payoutStatus, startPayoutSetup } from '@/api/payments'
import { ErrorText, Field } from '@/components/auth-ui'
import { Card, SmallButton, SwitchRow } from '@/components/form-ui'
import { ErrorRetry, Loading } from '@/components/state-view'
import { useLoad } from '@/hooks/use-load'
import { errorText, t } from '@/i18n'
import { useMe } from '@/hooks/use-me'
import { noteIfOff, paymentsOff, paymentsProblem } from '@/lib/payments-off'
import { payoutState, saveSwitch } from '@/lib/payouts'
import { isHttps } from '@/lib/safe-url'

/** "Set up payouts": the status and the Stripe link. `useLoad` re-checks the status on focus and when the app returns to the front (no polling). */
export function PayoutCard({ profile, onChanged, taxAsked }: { profile: MyProfile; onChanged: () => void; taxAsked: number }) {
  const me = useMe()
  const fetch = useCallback(() => payoutStatus(), [])
  const { data, error, retry } = useLoad(fetch)
  const [opened, setOpened] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const state = payoutState(data?.ready, opened)
  // The status call just recorded the payout as ready: reload the profile so the checklist drops the step (one Stripe call, one profile read per focus).
  const stale = !!data?.ready && !!profile.quoteSteps?.includes('payout')
  // Once per status load (and when the profile arrives later), never in a loop: a reload that returns the same profile does not retrigger it.
  const changed = useRef(onChanged)
  changed.current = onChanged
  useEffect(() => {
    if (stale) changed.current()
  }, [data, stale])
  if (error && noteIfOff(error)) return null // payments are off: nothing to set up, and a Retry could never succeed

  async function open() {
    setBusy(true)
    setProblem(null)
    try {
      const { url } = await startPayoutSetup()
      if (!isHttps(url)) throw new Error('bad link')
      setOpened(true)
      await WebBrowser.openBrowserAsync(url)
      retry()
    } catch (e) {
      setProblem(paymentsProblem(e))
    }
    setBusy(false)
  }

  const title = (
    <Text style={styles.title} accessibilityRole="header">
      {t('payouts.setUp')}
    </Text>
  )
  if (state === 'unknown')
    return (
      <Card>
        {title}
        {error ? <ErrorRetry code={error} onRetry={retry} /> : <Loading />}
      </Card>
    )
  return (
    <Card done={state === 'ready'}>
      {title}
      <Text style={styles.text}>{state === 'ready' ? t('payouts.ready') : state === 'waiting' ? t('payouts.waiting') : t('payouts.intro')}</Text>
      {state !== 'ready' && <Text style={styles.small}>{state === 'waiting' ? t('payouts.pending') : t('payouts.notStarted')}</Text>}
      {state !== 'ready' &&
        (paymentsOff(me) ? (
          <Text style={styles.text}>{errorText('PAYMENTS_OFF')}</Text>
        ) : (
          <SmallButton label={t(state === 'waiting' ? 'payouts.continue' : 'payouts.setUp')} onPress={open} busy={busy} />
        ))}
      <ErrorText text={problem} />
      <InvoicingFields initial={profile} onChanged={onChanged} taxAsked={taxAsked} />
    </Card>
  )
}

/** Invoicing, part of being ready to take work while payments are on: the tax number printed on invoices, and the consent tick. It follows the screen's saved profile (a half-typed tax number is never overwritten) and reloads it after each save, so the checklist above agrees. */
function InvoicingFields({ initial, onChanged, taxAsked }: { initial: MyProfile; onChanged: () => void; taxAsked: number }) {
  const [taxNumber, setTaxNumber] = useState(initial.taxNumber ?? '')
  const [consent, setConsent] = useState(!!initial.invoiceConsent)
  const taxDirty = useRef(false)
  useEffect(() => {
    if (!taxDirty.current) setTaxNumber(initial.taxNumber ?? '')
  }, [initial.taxNumber])
  useEffect(() => setConsent(!!initial.invoiceConsent), [initial.invoiceConsent])
  const [taxOpen, setTaxOpen] = useState(taxAsked > 0) // collapsed until the person needs it
  useEffect(() => {
    if (taxAsked > 0) setTaxOpen(true)
  }, [taxAsked])
  const [problem, setProblem] = useState<string | null>(null)
  async function save(body: object) {
    setProblem(null)
    try {
      await saveMyProfile(body)
      taxDirty.current = false
      onChanged()
    } catch (e) {
      setProblem(paymentsProblem(e))
    }
  }
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: taxOpen }} onPress={() => setTaxOpen(!taxOpen)} style={styles.toggle}>
        <Text style={styles.toggleText}>{taxNumber.trim() && !taxOpen ? `${t('payouts.taxNumber')}: ${taxNumber.trim()}` : t('payouts.taxNumber')}</Text>
        <Text style={styles.toggleText}>{taxOpen ? '▴' : '▾'}</Text>
      </Pressable>
      {taxOpen && <Field label={t('payouts.taxNumber')} hint={t('payouts.taxNumberHint')} value={taxNumber} onChangeText={(v) => {
        taxDirty.current = true
        setTaxNumber(v)
      }} onBlur={() => save({ taxNumber: taxNumber.trim() || null })} maxLength={40} autoCapitalize="none" autoCorrect={false} />}
      <SwitchRow
        label={t('payouts.invoiceConsent')}
        value={consent}
        onChange={(v) => {
          setProblem(null)
          // a failed save puts the switch back, so it never shows a consent the server does not have
          saveSwitch(v, setConsent, (x) => saveMyProfile({ invoiceConsent: x })).then(onChanged, (e) => setProblem(paymentsProblem(e)))
        }}
      />
      {!consent && <Text style={styles.small}>{t('payouts.invoiceConsentNeeded')}</Text>}
      <ErrorText text={problem} />
    </>
  )
}

const styles = StyleSheet.create({
  title: { fontSize: 17, fontWeight: '700', color: '#1D1C4A' },
  text: { fontSize: 16, color: '#1D1C4A' },
  small: { fontSize: 14, color: '#4F4E7D' },
  toggle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44 },
  toggleText: { fontSize: 15, fontWeight: '600', color: '#34328A' },
})
