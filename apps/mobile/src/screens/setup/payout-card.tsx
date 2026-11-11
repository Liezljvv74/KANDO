import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text } from 'react-native'

import type { MyProfile } from '@kando/contract'

import { payoutStatus } from '@/api/payments'
import { ErrorText, Field } from '@/components/auth-ui'
import { Card, SmallButton, SwitchRow } from '@/components/form-ui'
import { ErrorRetry, Loading } from '@/components/state-view'
import { useLoad } from '@/hooks/use-load'
import { errorText, t } from '@/i18n'
import { useMe, useQuoteSteps } from '@/hooks/use-me'
import { continueAfterAutoStep } from '@/lib/flow-state'
import { openPayoutSetup, payoutOpened, saveQuoteField } from '@/lib/do-quote-step'
import { noteIfOff, paymentsOff, paymentsProblem } from '@/lib/payments-off'
import { payoutState, saveSwitch } from '@/lib/payouts'
import { color } from '@/theme'

/** "Set up payouts": the status and the Stripe link. `useLoad` re-checks the status on focus and when the app returns to the front (no polling). `onSaved` gets the profile a save answered with. */
export function PayoutCard({ profile, onSaved, taxAsked }: { profile: MyProfile; onSaved: (p: MyProfile) => void; taxAsked: number }) {
  const me = useMe()
  const { steps, reload } = useQuoteSteps()
  const fetch = useCallback(() => payoutStatus(), [])
  const { data, error, retry, update } = useLoad(fetch)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => void (alive.current = false)
  }, [])
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const state = payoutState(data?.ready, payoutOpened())
  // A focus-time status call recorded the payout as ready (a missed webhook): reload /me once so the checklists drop the step.
  const stale = !!data?.ready && !!steps?.includes('payout')
  useEffect(() => {
    if (stale) reload().catch(() => {})
  }, [data, stale, reload])
  if (error && noteIfOff(error)) return null // payments are off: nothing to set up, and a Retry could never succeed

  // The same Stripe round trip as a checklist row: it reads the status once and reloads /me itself; its status answer is shown here as it is.
  async function open() {
    setBusy(true)
    setProblem(null)
    try {
      const status = await openPayoutSetup()
      if (status && data) update(() => status) // nothing held yet (the first load failed): update would drop it, so load again
      else retry()
      if (status?.ready && alive.current) void continueAfterAutoStep() // payouts ready: on to the next open step
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
      <InvoicingFields initial={profile} onSaved={onSaved} taxAsked={taxAsked} />
    </Card>
  )
}

/**
 * Invoicing, part of being ready to take work while payments are on: the tax number printed on invoices, and the consent tick.
 * Stays mounted (the open tax field and an error message survive a save); it follows the screen's saved profile (a half-typed tax
 * number is never overwritten). Each save hands its answer up and into `/me`, so the checklists agree without a reload.
 */
function InvoicingFields({ initial, onSaved, taxAsked }: { initial: MyProfile; onSaved: (p: MyProfile) => void; taxAsked: number }) {
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
      const saved = await saveQuoteField(body)
      taxDirty.current = false
      onSaved(saved)
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
          saveSwitch(v, setConsent, async (x) => onSaved(await saveQuoteField({ invoiceConsent: x }))).catch((e) => setProblem(paymentsProblem(e)))
        }}
      />
      {!consent && <Text style={styles.small}>{t('payouts.invoiceConsentNeeded')}</Text>}
      <ErrorText text={problem} />
    </>
  )
}

const styles = StyleSheet.create({
  title: { fontSize: 17, fontWeight: '700', color: color.ink },
  text: { fontSize: 16, color: color.ink },
  small: { fontSize: 14, color: color.inkMuted },
  toggle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44 },
  toggleText: { fontSize: 15, fontWeight: '600', color: color.indigo },
})
