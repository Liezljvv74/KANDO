import { StyleSheet, Text } from 'react-native'

import type { QuoteListItem } from '@kando/contract'

import { confirmQuote, withdrawRequest } from '@/api/bookings'
import { listQuoteDocuments } from '@/api/quotes'
import { Button, ErrorText } from '@/components/auth-ui'
import { Card } from '@/components/form-ui'
import { useLoad } from '@/hooks/use-load'
import { useSubmit } from '@/hooks/use-submit'
import { t } from '@/i18n'
import { confirmDanger } from '@/lib/confirm'
import { goReplace } from '@/lib/go'
import { closeSummary, lapseKey, lapsedQuoteOf } from '@/lib/lapse'

/**
 * A booking lapsed (its payment time passed, or the time was never agreed) and its quote is open again: says what lapsed and asks
 * "Do you still want it?". "Yes, book again" is the quote's usual confirm (`onBookAgain` where the screen has its own, with its own
 * dialog); "I don't need this anymore" asks first, then closes the whole job: the request is withdrawn, which expires a booking that
 * only lapsed in the lists, declines the quote and tells the provider (the same call as "Withdraw request").
 */
export function LapseBanner({ q, onBookAgain, onClosed, busy }: { q: QuoteListItem; onBookAgain?: () => void; onClosed: () => void; busy?: boolean }) {
  const action = useSubmit()
  if (!q.lapsed) return null
  const bookAgain = onBookAgain ?? (() => action.submit(async () => goReplace(`/bookings/${(await confirmQuote(q.quoteId)).id}`)))
  const notNeeded = async () => {
    if (await confirmDanger(closeSummary(q), t('lapse.closeYes'))) action.submit(() => withdrawRequest(q.requestId), onClosed)
  }
  return (
    <Card>
      <Text style={styles.text} accessibilityRole="alert">
        {t(lapseKey(q.lapsed))}
      </Text>
      <Button label={t('lapse.bookAgain')} onPress={bookAgain} busy={busy || action.busy} />
      <Button label={t('lapse.notNeeded')} onPress={notNeeded} busy={busy || action.busy} danger />
      <ErrorText text={action.problem} />
    </Card>
  )
}

/** The question on a screen that has no quote list of its own (the request, an expired booking): finds the request's lapsed quote and shows its banner. */
export function LapsedAsk({ requestId, onClosed }: { requestId: string; onClosed: () => void }) {
  const { data } = useLoad(listQuoteDocuments)
  const q = data && lapsedQuoteOf(data, requestId)
  return q ? <LapseBanner q={q} onClosed={onClosed} /> : null
}

const styles = StyleSheet.create({
  text: { fontSize: 16, color: '#1D1C4A' },
})
