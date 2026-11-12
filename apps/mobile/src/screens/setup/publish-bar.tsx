import { useEffect, useRef, useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'

import type { MyProfile, OwnService } from '@kando/contract'

import { ApiError } from '@/api/client'
import { publishProfile, unpublishProfile } from '@/api/my-profile'
import { ErrorText } from '@/components/auth-ui'
import { Card, SwitchRow } from '@/components/form-ui'
import { useCategories } from '@/hooks/use-categories'
import { useQuoteSteps } from '@/hooks/use-me'
import { canShare, type DocumentRow } from '@/lib/documents'
import { errorText, getLang, t } from '@/i18n'
import { liveLocked } from '@/lib/compulsory'
import { go } from '@/lib/go'
import { continueAfterAutoStep } from '@/lib/flow-state'
import { allSet, checklistHeading, checklistItems, openItems, rejectedItems } from '@/lib/live-checklist'
import { paymentsProblem } from '@/lib/payments-off'
import { doQuoteStep } from '@/lib/do-quote-step'
import { isLive } from '@/lib/profile-form'
import { providerUrl, shareProfile } from '@/lib/share-profile'
import { quoteBlocked } from '@/lib/quote-gate'
import { GateRow, QuoteGate } from '@/screens/bookings/quote-gate'
import { color } from '@/theme'

/**
 * The Live switch at the top of the page: on publishes, off takes the profile offline (after a question), driven by the server's
 * `missing` list of the latest profile response; `docRows` adds a "needs action" row per rejected required document. `onChanged` reloads the profile afterwards.
 */
export function PublishBar({ profile, services, docRows, onChanged, onSaved, onTaxId, highlight }: { highlight?: boolean; profile: MyProfile; services: OwnService[]; docRows: DocumentRow[]; onChanged: () => void; onSaved: (p: MyProfile) => void; onTaxId?: () => void }) {
  const { categories } = useCategories()
  const { steps } = useQuoteSteps()
  const [busy, setBusy] = useState(false)
  // Set when a publish succeeded here: the live message (with Share) shows until the page is left.
  const [justPublished, setJustPublished] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  // Set when the server answered 409 'Profile incomplete'; the next profile response clears it.
  const [refused, setRefused] = useState(false)
  useEffect(() => setRefused(false), [profile])

  async function run(action: () => Promise<unknown>, published = false) {
    setBusy(true)
    setProblem(null)
    try {
      await action()
      setJustPublished(published)
      onChanged()
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'network'
      setProblem(errorText(code))
      setRefused(code === 'Profile incomplete')
    }
    setBusy(false)
  }

  const live = profile.status === 'published'
  const change = (on: boolean) => {
    if (on) return void run(publishProfile, true)
    Alert.alert(t('myProfile.unpublishAsk'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('setup.takeOffline'), style: 'destructive', onPress: () => run(unpublishProfile) },
    ])
  }

  const waitingServices = services.filter((s) => (s.waitingFor ?? []).length > 0)
  const waiting = waitingServices.length
  // Switched off and greyed out while the profile is incomplete; the starred fields say what is needed.
  const locked = liveLocked(profile, refused)
  const later = steps ?? []
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => void (alive.current = false)
  }, [])
  const stepping = useRef(false) // a double tap must not start Stripe or save twice
  const doStep = async (step: (typeof later)[number]) => {
    if (stepping.current) return
    stepping.current = true
    setProblem(null)
    try {
      const saved = await doQuoteStep(step, onTaxId, () => {
        if (alive.current) void continueAfterAutoStep(() => alive.current)
      }) // the step updates /me itself; only a save's answer is handed up (no list reload)
      if (saved) onSaved(saved)
    } catch (e) {
      setProblem(paymentsProblem(e))
    }
    stepping.current = false
  }
  const rows = checklistItems(profile, docRows)
  const items = openItems(rows)
  const rejected = rejectedItems(rows)
  const checking = rows.filter((r) => r.state === 'checking')
  return (
    <>
    <View style={highlight ? styles.highlight : undefined}>
    <Card>
      <SwitchRow label={t(live ? 'setup.live' : 'setup.inactive')} value={live} onChange={change} disabled={busy || locked} />
      {locked ? <Text style={styles.hint}>{t('setup.liveLocked')}</Text> : null}
      {items.length > 0 && (
        <>
          <Text style={styles.heading} accessibilityRole="header">{t(checklistHeading(items.length), { n: items.length })}</Text>
          {items.map((r) => (
            <GateRow key={r.item} title={r.label} onDo={() => go(r.path)} />
          ))}
        </>
      )}
      {rejected.map((r) => (
        <GateRow key={r.item} title={r.label} hint="setup.docRejected" onDo={() => go(r.path)} />
      ))}
      {checking.map((r) => (
        <View key={r.item} style={styles.checking}>
          <Text style={styles.name}>{t(r.label)}</Text>
          <Text style={styles.awaiting}>{t('setup.awaitingApproval')}</Text>
          <Text style={styles.hint}>{t('setup.weAreChecking')}</Text>
        </View>
      ))}
      {allSet(profile, steps, docRows) ? <Text style={styles.done}>{t('setup.allSet')}</Text> : null}
      {live && !isLive(profile) ? <ErrorText text={errorText('Profile suspended')} /> : null}
      {live && isLive(profile) && waiting > 0 ? <Text style={styles.live}>{t('setup.liveWaiting', { count: waiting })}</Text> : null}
      {justPublished && live && isLive(profile) && (
        <>
          {waiting > 0 ? <Text style={styles.live}>{t('setup.pendingMessage', { category: categories?.find((c) => c.id === waitingServices[0]!.category)?.name ?? waitingServices[0]!.title })}</Text> : null}
          {canShare(services) && profile.slug ? (
            <Pressable
              onPress={() => shareProfile(providerUrl(profile.slug!, getLang()), getLang())}
              accessibilityRole="button"
              accessibilityLabel={t('setup.share')}
              style={({ pressed }) => [styles.share, pressed && styles.sharePressed]}
            >
              <Text style={styles.shareLabel}>{t('setup.share')}</Text>
            </Pressable>
          ) : null}
        </>
      )}
      <ErrorText text={problem} />
    </Card>
    </View>
    {quoteBlocked(later) && <QuoteGate steps={later} onDo={doStep} heading={t('setup.bookableHeading')} note={t('setup.bookableNote')} />}
    </>
  )
}

const styles = StyleSheet.create({
  highlight: { borderWidth: 3, borderColor: color.indigo, borderRadius: 18 },
  live: { fontSize: 16, fontWeight: '700', color: color.indigo },
  // 3D: a darker slab under the button; pressing sinks it onto the slab.
  share: { minHeight: 52, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: color.teal, borderBottomWidth: 6, borderBottomColor: '#0E7C75', borderTopWidth: 1, borderTopColor: '#7FE3DC' },
  sharePressed: { borderBottomWidth: 2, marginTop: 4 },
  shareLabel: { fontSize: 16, fontWeight: '700', color: color.ink, textAlign: 'center' },
  hint: { fontSize: 14, color: color.inkMuted },
  heading: { fontSize: 17, fontWeight: '700', color: color.ink },
  checking: { minHeight: 44, justifyContent: 'center' },
  name: { fontSize: 16, color: color.ink },
  awaiting: { fontSize: 15, fontWeight: '600', color: color.inkMuted },
  done: { fontSize: 16, fontWeight: '700', color: '#1F6B3A' },
})
