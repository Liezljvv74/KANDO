import { useCallback, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import type { Booking, Review, ReviewInput } from '@kando/contract'

import { editReview, myReviews, writeReview } from '@/api/reviews'
import { Button, ErrorText, Field, Info } from '@/components/auth-ui'
import { Card, SmallButton } from '@/components/form-ui'
import { useLoad } from '@/hooks/use-load'
import { useSubmit } from '@/hooks/use-submit'
import { t } from '@/i18n'
import { formatWhen } from '@/lib/booking-time'
import { reviewView } from '@/lib/review-state'

const starLabel = (n: number) => (n === 1 ? t('review.star.one') : t('review.star.other', { n }))
const stars = (n: number) => `${'★'.repeat(n)}${'☆'.repeat(5 - n)}`

/** 1 to 5 stars and an optional text: a new review, or a change to my own while it is still blind. */
function ReviewForm({ initial, onSubmit, submitLabel }: { initial?: Review; onSubmit: (input: ReviewInput) => Promise<unknown>; submitLabel: string }) {
  const [count, setCount] = useState(initial?.stars ?? 0)
  const [text, setText] = useState(initial?.text ?? '')
  const { busy, problem, setProblem, submit } = useSubmit()
  const send = () => (count < 1 ? setProblem(t('review.starsMissing')) : submit(() => onSubmit({ stars: count, ...(text.trim() && { text: text.trim() }) })))
  return (
    <>
      <View style={styles.starRow} accessibilityRole="radiogroup">
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable key={n} onPress={() => setCount(n)} disabled={busy} accessibilityRole="radio" accessibilityLabel={starLabel(n)} accessibilityState={{ checked: count === n }} style={styles.star}>
            <Text style={styles.starText}>{n <= count ? '★' : '☆'}</Text>
          </Pressable>
        ))}
      </View>
      <Field label={t('review.textField')} value={text} onChangeText={setText} multiline maxLength={2000} editable={!busy} />
      <ErrorText text={problem} />
      <Button label={submitLabel} onPress={send} busy={busy} />
    </>
  )
}

/** The reviews of a completed booking: mine (editable until it is shown) and, once shown, the other side's. */
export function ReviewPanel({ booking }: { booking: Booking }) {
  const { data, retry } = useLoad(myReviews)
  const [editing, setEditing] = useState(false)
  const done = useCallback(() => {
    setEditing(false)
    retry()
  }, [retry])
  if (!data) return null
  const now = new Date()
  const { mine, theirs, canWrite, canEdit } = reviewView(data, booking.id, now)
  return (
    <Card>
      <Text style={styles.title}>{t('review.title')}</Text>
      {canWrite && (
        <>
          <Info text={t('review.ask')} />
          <ReviewForm submitLabel={t('review.send')} onSubmit={async (input) => (await writeReview(booking.id, input), done())} />
        </>
      )}
      {mine && (
        <>
          <Text style={styles.label}>{t('review.mine')}</Text>
          <Text style={styles.stars} accessibilityLabel={starLabel(mine.stars)}>
            {stars(mine.stars)}
          </Text>
          {!!mine.text && <Text style={styles.text}>{mine.text}</Text>}
          {mine.hidden && <Info text={t('review.hidden')} />}
          {!!mine.visibleAt && new Date(mine.visibleAt) > now && <Info text={t('review.shownFrom', { date: formatWhen(mine.visibleAt) })} />}
          {canEdit && mine.editableUntil ? <Info text={t('review.editUntil', { date: formatWhen(mine.editableUntil) })} /> : <Info text={t('review.final')} />}
          {canEdit &&
            (editing ? (
              <ReviewForm initial={mine} submitLabel={t('review.save')} onSubmit={async (input) => (await editReview(mine.id, input), done())} />
            ) : (
              <SmallButton label={t('review.edit')} onPress={() => setEditing(true)} />
            ))}
        </>
      )}
      <Text style={styles.label}>{t('review.theirs')}</Text>
      {theirs ? (
        <>
          <Text style={styles.stars} accessibilityLabel={starLabel(theirs.stars)}>
            {stars(theirs.stars)}
          </Text>
          {!!theirs.text && <Text style={styles.text}>{theirs.text}</Text>}
        </>
      ) : (
        <Info text={t('review.waitTheirs')} />
      )}
    </Card>
  )
}

const styles = StyleSheet.create({
  title: { fontSize: 18, fontWeight: '700', color: '#14352E' },
  label: { fontSize: 14, fontWeight: '600', color: '#14352E' },
  text: { fontSize: 16, color: '#14352E' },
  starRow: { flexDirection: 'row' },
  stars: { fontSize: 20, color: '#0E8A6B' },
  star: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  starText: { fontSize: 28, color: '#0E8A6B' },
})
