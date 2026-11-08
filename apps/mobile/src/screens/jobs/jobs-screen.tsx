import { useCallback, useState, useSyncExternalStore } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import type { JobRow } from '@kando/contract'

import type { Role } from '@/api/bookings'
import { getJobs, jobCounts } from '@/api/jobs'
import { Button, ErrorText, Field } from '@/components/auth-ui'
import { Card, FormScreen, SectionTitle } from '@/components/form-ui'
import { ErrorRetry, Loading } from '@/components/state-view'
import { useLoad } from '@/hooks/use-load'
import { useMe } from '@/hooks/use-me'
import { useMore } from '@/hooks/use-more'
import { getLang, t, useLang, type Key } from '@/i18n'
import { go } from '@/lib/go'
import { headerDate } from '@/lib/job-header'
import { pastPage, type JobSection } from '@/lib/jobs'
import { stateText } from '@/lib/job-state-text'
import { InvoicesFold } from '@/screens/jobs/invoices-fold'

const open = (row: JobRow) => go(`/bookings/request/${row.id}`) // the job page
/** The small tag on a search result: the section the job sits in. */
const TAG: Record<JobSection, Key> = { needs_you: 'jobs.needsYou', active: 'jobs.tag.active', past: 'jobs.tag.past' }

/** One job: title, number, other party and date, and what the job's state says for my side. A search result carries its section. */
function JobCard({ row, role, tag }: { row: JobRow; role: Role; tag?: boolean }) {
  const state = stateText(row.jobState, role, { number: row.number })?.title
  return (
    <Pressable accessibilityRole="button" onPress={() => open(row)}>
      <Card list>
        <Text style={styles.text} numberOfLines={2}>
          {row.title}
        </Text>
        <Text style={styles.small}>{[`#${row.number}`, row.otherParty, headerDate(row.date, getLang())].filter(Boolean).join(' · ')}</Text>
        <Text style={styles.small}>{[state, tag && t(TAG[row.jobState.section])].filter(Boolean).join(' · ')}</Text>
        {row.unread > 0 &&
          (row.threadId ? (
            <Pressable accessibilityRole="button" onPress={() => go(`/threads/${row.threadId}`)}>
              <Text style={styles.unread}>{t('jobs.unread')}</Text>
            </Pressable>
          ) : (
            <Text style={styles.unread}>{t('jobs.unread')}</Text>
          ))}
      </Card>
    </Pressable>
  )
}

/** A past job on one line: title, date, outcome. */
const PastLine = ({ row, role }: { row: JobRow; role: Role }) => (
  <Pressable accessibilityRole="button" onPress={() => open(row)} style={styles.pastLine}>
    <Text style={styles.small} numberOfLines={1}>
      {[row.title, headerDate(row.date, getLang()), stateText(row.jobState, role)?.title].filter(Boolean).join(' · ')}
    </Text>
  </Pressable>
)

/** "Show more" and its error under a paged list. */
const More = ({ list }: { list: { next: string | null; showMore: () => void; busy: boolean; problem: string | null } }) => (
  <>
    {list.next && <Button label={t('list.showMore')} onPress={list.showMore} busy={list.busy} />}
    <ErrorText text={list.problem} />
  </>
)

/** The Jobs tab: what needs me, what is running, what is over (folded), for one side at a time; search over all three. */
export default function JobsScreen() {
  useLang()
  const me = useMe()
  const both = !!me?.isProvider
  const [role, setRole] = useState<Role>('customer')
  const [pastOpen, setPastOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [query, setQuery] = useState('')

  // "Needs you" of both sides comes from the shared counts load (it also feeds the tab badge and the switch counters); the tabs
  // layout refreshing at the same moment joins the same call. Per focus: one call per side plus "Active jobs" (and "Past" if open).
  const fetch = useCallback(async () => {
    const [pages, active] = await Promise.all([jobCounts.load(both ? ['customer', 'provider'] : ['customer']), getJobs(role, { section: 'active' })])
    // the load is keyed by the sides asked for, so the role is there; only a role no longer offered (provider, not a provider now) is fetched alone
    return { role, needs: pages[role] ?? (await getJobs(role, { section: 'needs_you' })), active }
  }, [role, both])
  const { data, error, retry } = useLoad(fetch)
  // Past has its own load: opening or closing it never reloads the other sections.
  const pastFetch = useCallback(async () => ({ role, page: await pastPage(pastOpen, () => getJobs(role, { section: 'past' })) }), [role, pastOpen])
  const pastLoad = useLoad(pastFetch)
  const searchFetch = useCallback(async () => (query ? { role, query, page: await getJobs(role, { q: query }) } : undefined), [role, query])
  const search = useLoad(searchFetch)

  // Old data (the other side, the previous search) stays in the loads while the new one runs: show it only when it matches.
  const current = data?.role === role ? data : undefined
  const more = (section: JobSection) => (c: string) => getJobs(role, { section, cursor: c })
  const needs = useMore<JobRow>(current?.needs, more('needs_you'))
  const active = useMore<JobRow>(current?.active, more('active'))
  const past = useMore<JobRow>(pastLoad.data?.role === role ? pastLoad.data.page : undefined, more('past'))
  const found = search.data?.role === role && search.data.query === query ? search.data.page : undefined
  const results = useMore<JobRow>(found, (c) => getJobs(role, { q: query, cursor: c }))

  const counters = useSyncExternalStore(jobCounts.subscribe, jobCounts.get)
  const pastCount = current?.needs.counts.past
  const label = (side: Role) => {
    const text = t(side === 'customer' ? 'booking.asCustomer' : 'booking.asProvider')
    return counters[side] > 0 ? `${text} (${counters[side]})` : text
  }

  return (
    <FormScreen title={t('tab.jobs')} back={false}>
      {both && (
        <View style={styles.switch}>
          {(['customer', 'provider'] as const).map((side) => (
            // the chosen side is filled and bold; the other is an outline that switches to it (a tap on the chosen one does nothing)
            <Pressable key={side} accessibilityRole="button" accessibilityState={{ selected: role === side }} onPress={() => setRole(side)} style={[styles.side, role === side ? styles.sideOn : styles.sideOff]}>
              <Text style={[styles.sideText, role === side && styles.sideTextOn]}>{label(side)}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <Field
        label={t('jobs.search')}
        placeholder={t('jobs.searchHint')}
        value={typed}
        maxLength={100}
        returnKeyType="search"
        onChangeText={(v) => {
          setTyped(v)
          if (!v.trim()) setQuery('')
        }}
        onSubmitEditing={() => setQuery(typed.trim())}
      />
      {query ? (
        found ? (
          <>
            {results.docs.map((r) => (
              <JobCard key={r.id} row={r} role={role} tag />
            ))}
            {results.docs.length === 0 && <Text style={styles.small}>{t('common.noMatches')}</Text>}
            <More list={results} />
          </>
        ) : search.error ? (
          <ErrorRetry code={search.error} onRetry={search.retry} />
        ) : (
          <Loading />
        )
      ) : !current ? (
        error ? <ErrorRetry code={error} onRetry={retry} /> : <Loading />
      ) : (
        <>
          <SectionTitle text={t('jobs.needsYou')} />
          {needs.docs.map((r) => (
            <JobCard key={r.id} row={r} role={role} />
          ))}
          {needs.docs.length === 0 && <Text style={styles.small}>{t('jobs.needsYouNone')}</Text>}
          <More list={needs} />
          {active.docs.length > 0 && <SectionTitle text={t('jobs.active')} />}
          {active.docs.map((r) => (
            <JobCard key={r.id} row={r} role={role} />
          ))}
          <More list={active} />
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: pastOpen }} onPress={() => setPastOpen((o) => !o)}>
            <SectionTitle text={`${t('jobs.past', { n: pastCount ?? past.docs.length })} ${pastOpen ? '▾' : '▸'}`} />
          </Pressable>
          {pastOpen && past.docs.map((r) => <PastLine key={r.id} row={r} role={role} />)}
          {pastOpen && pastLoad.error && <ErrorRetry code={pastLoad.error} onRetry={pastLoad.retry} />}
          {pastOpen && <More list={past} />}
        </>
      )}
      {/* For everyone: customers' receipts live here too (and providers who stopped offering keep theirs). */}
      <InvoicesFold provider={both} />
    </FormScreen>
  )
}

const styles = StyleSheet.create({
  switch: { flexDirection: 'row', gap: 8 },
  side: { flex: 1, minHeight: 48, borderRadius: 4, borderWidth: 2, borderColor: '#34328A', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  sideOn: { backgroundColor: '#19C3B8' },
  sideOff: { backgroundColor: '#fff' },
  sideText: { fontSize: 16, fontWeight: '600', color: '#34328A', textAlign: 'center' },
  sideTextOn: { fontWeight: '800', color: '#1D1C4A' },
  text: { fontSize: 16, color: '#1D1C4A' },
  small: { fontSize: 14, color: '#4F4E7D' },
  unread: { fontSize: 14, fontWeight: '700', color: '#34328A' },
  pastLine: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#CFE6DC' },
})
