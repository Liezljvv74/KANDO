import { TIME_ZONE } from '@kando/i18n'

export const LATE_CANCEL_SHARE = 0.5
export const NO_SHOW_OBJECTION_HOURS = 48
export const DISPUTE_DECISION_WORKING_DAYS = 14
export const STOP_ANSWER_DAYS = 7
export const REVIEW_VISIBLE_DAYS = 7
export const REVIEW_EDIT_DAYS = 14
export const CONFIRM_DAYS = 7
export const CONFIRM_REMINDER_DAYS = [1, 3, 6] as const
export const ASK_DONE_HOURS = 24
export const NO_ACTION_STAFF_DAYS = 7
export const ADDITIONAL_PAY_HOURS = 48
const FREE_CANCEL_HOURS = 24

const MIN = 60_000
const HOUR = 3_600_000
const DAY = 24 * HOUR

/** The end of a booking: real elapsed minutes, so a DST change inside the job does not shift it. */
export const endOf = (b: { startAt: Date; durationMin: number }): Date => {
  if (!Number.isFinite(b.durationMin) || b.durationMin <= 0) throw new Error('durationMin must be positive')
  return new Date(b.startAt.getTime() + b.durationMin * MIN)
}

// Wall-clock fields of an instant in the display zone.
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
const wall = (t: number) => {
  const p: Record<string, number> = {}
  for (const { type, value } of fmt.formatToParts(new Date(t))) if (type !== 'literal') p[type] = Number(value)
  return p as { year: number; month: number; day: number; hour: number; minute: number; second: number }
}
/** Zone offset in ms at an instant (wall clock read as UTC, minus the instant). */
const offsetAt = (t: number) => {
  const w = wall(t)
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(t / 1000) * 1000
}
/** The instant whose wall clock in the zone is the given UTC-read fields. A time skipped by DST resolves just after the gap. */
const fromWall = (asUtc: number, ms: number) => {
  let t = asUtc - offsetAt(asUtc)
  t = asUtc - offsetAt(t)
  return t + ms
}

/**
 * Monday to Friday in the display zone, keeping the wall-clock time (so 10:00 stays 10:00 across a DST change).
 * Public holidays are not counted: they are per country, added later.
 */
export const addWorkingDays = (from: Date, days: number): Date => {
  if (!Number.isInteger(days) || days < 0) throw new Error('days must be a non-negative integer')
  const t = from.getTime()
  const ms = ((t % 1000) + 1000) % 1000
  const w = wall(t)
  const day = new Date(Date.UTC(w.year, w.month - 1, w.day))
  for (let left = days; left > 0; ) {
    day.setUTCDate(day.getUTCDate() + 1)
    const dow = day.getUTCDay()
    if (dow !== 0 && dow !== 6) left--
  }
  return new Date(fromWall(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), w.hour, w.minute, w.second), ms))
}

/** Late means less than 24 hours to go; exactly 24 hours before the start is still free. */
export const isLate = (startAt: Date, now: Date): boolean => now.getTime() > startAt.getTime() - FREE_CANCEL_HOURS * HOUR

/** Integer cents, half up; the small precision trim keeps 1.005 * 100 from landing on 100.49999. */
const toCents = (x: number) => Math.round(Number((x * 100).toPrecision(12)))

/** What the provider is paid when the customer cancels: nothing in time, the late share otherwise. Never above the amount. */
export const customerCancelShare = (amount: number, startAt: Date, now: Date): number => {
  if (!isLate(startAt, now)) return 0
  const cents = toCents(amount)
  return Math.min(cents, Math.round(cents * LATE_CANCEL_SHARE)) / 100
}

/** When both reviews are in they show now; otherwise 7 days after completion. */
export const reviewVisibleAt = (completedAt: Date, bothIn: boolean, now: Date): Date =>
  bothIn ? now : new Date(completedAt.getTime() + REVIEW_VISIBLE_DAYS * DAY)

/** The author may edit for 14 days after completion, then the review is final. */
export const canEditReview = (completedAt: Date, now: Date): boolean => now.getTime() <= completedAt.getTime() + REVIEW_EDIT_DAYS * DAY

/**
 * Reminder number `sent + 1` is due once its day mark has passed. One per run: a late run sends the
 * oldest unsent one, and the next run the next, so no mark is skipped.
 */
export const dueConfirmReminder = (finishedAt: Date, sent: number, now: Date): boolean => {
  const day = CONFIRM_REMINDER_DAYS[sent]
  return day !== undefined && now.getTime() >= finishedAt.getTime() + day * DAY
}
