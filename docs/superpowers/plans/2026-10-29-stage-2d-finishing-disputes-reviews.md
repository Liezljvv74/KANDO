# Stage 2d: finishing, cancellations, disputes, additional tasks and reviews Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A paid booking can end every way the spec allows: the provider taps "Finished" and the customer confirms or stays silent for 7 days (payment and commission released); the provider never taps and the customer or staff resolve it; either side cancels or reports a no-show; the customer disputes and staff decide; either side stops the job; extra work runs as a linked "Additional task" booking; both sides write blind reviews; staff run all of it from the back office.

**Architecture:** New statuses and columns on plan 2a's `bookings`; two new tables (`disputes`, `reviews`) readable by the parties and written only on the owner connection after the domain checks the caller. Every ending that moves money calls plan 2c's `settle(exec, bookingId, providerShare)` and then sets the final status on the owner connection. Pattern for every ending: authorise the caller and check the status on the request transaction (`tx`, so RLS proves they are a party), then do the status change, dispute row and settlement in one owner-connection transaction that locks the booking row and re-checks the status (so a racing timer or second tap finds it already moved and does nothing). Pure rules (shares, working days, review visibility) live in `packages/domain/src/bookings/ending-rules.ts`; the clocks are added to plan 2a's `runDueTimers`.

**Tech Stack:** existing stack; Refine (`@refinedev/antd`) for the back office; nothing new installed.

**Spec:** `docs/superpowers/specs/2026-10-29-stage-2-booking-and-money-design.md` (sections 3.5 to 3.9, 4, 7a "Finished and silence", "Stop job", "Commission", "Additional task"). Builds on plans 2a (`2026-10-29-stage-2a-requests-quotes-bookings.md`), 2b (`2026-10-29-stage-2b-chat.md`) and 2c (`2026-10-29-stage-2c-payments.md`); their names are reused verbatim. Read `apps/web/AGENTS.md` and `apps/mobile/AGENTS.md` first.

## Global Constraints

- "Finished" is available from the agreed start time. The customer has 7 days from the tap to confirm or open a dispute; reminders after 1, 3 and 6 days say plainly that the payment to the provider is coming and when. Confirming, or 7 days without a response, releases the payment; the customer is told it has been made; commission goes to KANDO at the same moment (the same `settle` call).
- Provider never taps: 24 hours after the agreed end the customer is asked "Was the job done?" and can confirm or report a problem (a provider no-show is reported this way and refunded in full); if nobody acts within 7 days after the end time, the booking goes to staff and the money stays frozen.
- Cancellation (my call in the spec, lawyer to confirm): free for either side up to 24 hours before the start, full refund; a later customer cancellation pays the provider 50% (`LATE_CANCEL_SHARE = 0.5`, one constant); a customer no-show pays the provider 100%; a provider cancelling late or not turning up: full refund to the customer and recorded on the provider's profile; KANDO absorbs the payment processing fee on in-time cancellations (the customer gets the full amount back; Stripe's kept fee is KANDO's cost).
- No-show reports (foundation design, my call there): the other side has 48 hours to object (`NO_SHOW_OBJECTION_HOURS = 48`); an objection becomes a dispute. First provider no-show in 12 months: a warning in the app; the second: staff are flagged to suspend for 30 days with the existing suspension tool.
- Disputes: the customer may open one from "Finished" until the 7 days run out; it freezes the money; a staff member decides within 14 working days (`DISPUTE_DECISION_WORKING_DAYS = 14`, Monday to Friday, no public holidays: holidays are per country, later) using the chat and photos: full refund, partial, or full payout, with a written reason sent to both sides.
- Stop job: either side, at any time while `confirmed`; unearned money stays frozen; the provider states the amount earned (hours times the rate, or a percentage for fixed-price work); the customer agrees with one tap or disputes; staff decide a disputed one with a free-form amount, defaulting to the provider's statement for hourly work. Customer silence on a stated amount for 7 days (`STOP_ANSWER_DAYS = 7`, my call) sends it to staff.
- Additional task: a separate booking linked to the original (`parentBookingId`), started by the customer's "Additional task" or the provider's "Scope/quote review" button, using the normal quote, accept and pay flow, labelled "Additional task", with its own payment, "Finished" clock, payout and dispute; refunded and paid out independently; work on it starts only after it is accepted and paid; a short explanation is shown during negotiation.
- Reviews: after a job is confirmed (root booking `completed`), both sides write one review (1 to 5 stars, text up to 2000 characters) before seeing the other's; both appear together once both are in, or after 7 days (`REVIEW_VISIBLE_DAYS = 7`); the author may edit for 14 days (`REVIEW_EDIT_DAYS = 14`), then it is final; staff can hide one that breaks the rules, with a reason.
- Commission only on the amount actually paid out; percentage from `bookings.commission_rate` (plan 2c). All free text (dispute descriptions, stop notes, review text) runs plan 2b's `assertNoContactDetails`.
- German and English everywhere, back office included; no competitor names; never "Treuhand", "Escrow" or "Garantie". Enums `text` plus `check`. Migration `0016`. Every new table in exactly one `rls.ts` map, isolation test, `cleanupUsers()`. Owner merges; report in `Reports/`; no AI co-author lines.

## Review Focus

- Customer confirms at the same moment the 7-day timer releases: one settlement, one set of ledger rows, one "payment made" message (Task 3 test `confirm racing the timer settles once`).
- A dispute opened one minute before the 7 days end, while the timer is running: the dispute wins or the release wins, never both (Task 5 test `dispute and auto-release race: exactly one outcome`).
- Cancelling a booking that has an unpaid or paid additional task: the additional task is handled by its own rules (unpaid: withdrawn; paid: same cancellation rule on its own amount), never forgotten (Task 4 test).
- A staff partial decision larger than the amount paid, negative, or with an empty reason: 400 (Task 8 test).
- A provider tapping "Finished" before the start time, or twice: 409, no second clock (Task 3 test).

## File structure

- `packages/db/src/schema/endings.ts` (new): `disputes`, `reviews`. Modify plan 2a's `schema/bookings.ts` (statuses, columns, `parentBookingId`) and `requests` (`parentBookingId`), `schema/notifications.ts`, plan 2b's `staff_flags` kinds. Migration `0016_endings.sql` (generated).
- `packages/db/src/rls.ts`: classify the tables; append to plan 2c's `OWNER_ONLY_BOOKING_STATUSES`; definer function `provider_reliability`.
- `packages/contract/src/endings.ts` (new): finish, cancel, no-show, dispute, stop, review and staff-decision schemas.
- `packages/domain/src/bookings/ending-rules.ts`, `finish.ts`, `cancel.ts`, `disputes.ts`, `stop.ts`, `additional.ts` (new); `packages/domain/src/reviews.ts` (new); `packages/domain/src/admin/bookings.ts` (new); modify plan 2a's `bookings/timers.ts`, `bookings/rules.ts` (`canTransition`), `bookings/requests.ts` (`acceptQuote`), `bookings/notify.ts`; plan 2b's `staffMayReadThread`, `threadForBooking`; plan 2c's account-deletion refusal list.
- Routes under `apps/web/app/app-api/v1/bookings/[id]/{finish,confirm,cancel,no-show,no-show/object,dispute,stop,stop/amount,stop/answer,additional-task}/route.ts`, `reviews/route.ts`, `reviews/[id]/route.ts`; admin `apps/web/app/api/admin/disputes/[id]/decide/route.ts`, `bookings/[id]/refund/route.ts`, `reviews/[id]/hide/route.ts`; pages `apps/web/app/admin/{bookings,disputes,refunds,reviews}/**`.
- Mobile: `apps/mobile/src/api/bookings.ts` (extend), `apps/mobile/src/api/reviews.ts`, screens under `apps/mobile/src/screens/bookings/` and `reviews/`.

### Task 1: Tables, statuses and row-level security

**Files:** Create `packages/db/src/schema/endings.ts`, migration `0016_endings.sql`; modify the schema files above, `rls.ts`, `apps/web/tests/helpers.ts`; test `apps/web/tests/rls-endings.int.spec.ts`.

**Interfaces:**
- Changes to plan 2a's tables (on top of plan 2c's):
  - `bookings.status` check adds `finished|completed|disputed|cancelled|stopped|refunded`. New nullable columns: `parentBookingId` uuid (references `bookings.id`), `finishedAt`, `confirmBy`, `confirmRemindersSent` int not null default 0, `askedDoneAt`, `completedAt`, `cancelledAt`, `cancelledBy` text (`customer|provider`), `lateCancel` boolean not null default false, `noShow` text (`customer|provider`), `noShowReportedAt`, `stoppedAt`, `stoppedBy` text, `stopAmount numeric(10,2)`, `stopNote` text, `stopStatedAt`, `materialAmount numeric(10,2)` not null default 0 (the material part, stated at "Finished"; used by plan 2e's invoices).
  - `requests.parentBookingId` uuid nullable (an additional task's request).
- New tables:
  - `disputes`: `id`, `bookingId` (unique: one dispute per booking), `openedBy` text nullable (null = the system), `reason` check `problem|no-show-objection|no-response|stop-disagreed|chargeback`, `description` text, `createdAt`, `decideBy`, `decision` check `full-payout|partial|full-refund` nullable, `providerShare numeric(10,2)` nullable, `decisionReason` text nullable, `decidedBy`, `decidedAt` nullable.
  - `reviews`: `id`, `bookingId` (the root booking), `authorId`, `subjectId`, `authorRole` check `customer|provider`, `stars` int check `between 1 and 5`, `text` nullable, `hidden` boolean default false, `hiddenReason` nullable, `createdAt`, `updatedAt`, `visibleAt` nullable; unique `(booking_id, author_id)`.
- `rls.ts`: `disputes` in `PUBLISHED_READ_TABLES` with the party expression through its booking (my call: that map means "readable where the expression holds, written only on the owner connection"; add that sentence to its comment); `reviews` in `PUBLISHED_READ_TABLES` with `(NOT hidden AND visible_at IS NOT NULL AND visible_at <= now()) OR author_id = app_current_user_id()`. `OWNER_ONLY_BOOKING_STATUSES` becomes `['confirmed','completed','cancelled','refunded']`. Definer function `provider_reliability(p_provider uuid) RETURNS int`: provider late cancellations plus provider no-shows in the last 12 months (only the count, for the public page).
- Notification kinds added: `job-finished`, `confirm-reminder`, `payment-released`, `was-job-done`, `booking-cancelled`, `no-show-reported`, `dispute-opened`, `dispute-decided`, `job-stopped`, `stop-amount-stated`, `additional-task-requested`, `review-requested`, `review-visible`, `provider-warning`. `staff_flags.kind` adds `ignored-requests`, `provider-no-shows`, `dispute-overdue`.
- [ ] **Step 1: Write tests**: `parties read their dispute; a third user does not; app_user cannot insert one`, `a hidden review and a not-yet-visible review are invisible to others but visible to the author`, `app_user cannot set completed, cancelled or refunded`, `provider_reliability returns a count only`; `db-migrations.int.spec.ts` passes.
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run tests/rls-endings.int.spec.ts tests/db-migrations.int.spec.ts`: FAIL. **Step 3: Implement**, `pnpm db:generate`. **Step 4: Run**: PASS.
- [ ] **Step 5: Commit** `feat(db): booking endings, disputes and reviews`.

### Task 2: Ending rules (pure)

**Files:** Create `packages/domain/src/bookings/ending-rules.ts`; modify plan 2a's `bookings/rules.ts`; test `packages/domain/src/bookings/ending-rules.test.ts`.

**Interfaces:**
- Produces: the constants of Global Constraints plus `CONFIRM_DAYS = 7`, `CONFIRM_REMINDER_DAYS = [1, 3, 6]`, `ASK_DONE_HOURS = 24`, `NO_ACTION_STAFF_DAYS = 7`, `ADDITIONAL_PAY_HOURS = 48` (my call: an additional task's pay window, since its start may be past); `endOf(b: { startAt: Date; durationMin: number }): Date`; `addWorkingDays(from: Date, days: number): Date` (Monday to Friday in the display zone `TIME_ZONE`); `customerCancelShare(amount: number, startAt: Date, now: Date): number` (0 when `now <= startAt - 24h`, else `round2(amount * LATE_CANCEL_SHARE)`); `isLate(startAt: Date, now: Date): boolean`; `reviewVisibleAt(completedAt: Date, bothIn: boolean, now: Date): Date | null`; `dueConfirmReminder(finishedAt: Date, sent: number, now: Date): boolean`.
- `canTransition` (plan 2a) adds: `confirmed` to `finished|cancelled|stopped|disputed|completed`; `finished` to `completed|disputed`; `stopped` to `completed|disputed`; `disputed` to `completed|refunded|cancelled`.
- [ ] **Step 1: Write tests**: `addWorkingDays(Friday 10:00, 1)` is Monday 10:00 and `(Monday 10:00, 14)` is Monday plus 18 calendar days (a Friday); `customerCancelShare(100, start, start - 24h)` is `0`, at `start - 23h59m` is `50`, `(33.33, …late)` is `16.67`; `dueConfirmReminder(finished, 0, finished + 1d)` true, `(finished, 1, finished + 2d)` false, `(finished, 1, finished + 3d)` true; `reviewVisibleAt` returns `now` when both are in and `completedAt + 7d` otherwise; `canTransition('finished','stopped')` false.
- [ ] **Step 2: Run** `pnpm --filter @kando/domain test`: FAIL. **Step 3: Implement**. **Step 4: Run**: PASS.
- [ ] **Step 5: Commit** `feat(domain): finishing, cancellation and review timing rules`.

### Task 3: Finished, confirmation, automatic release and the silent provider

**Files:** Create `packages/contract/src/endings.ts` (finish and confirm parts), `packages/domain/src/bookings/finish.ts`; routes `bookings/[id]/finish`, `bookings/[id]/confirm`; modify plan 2a's `timers.ts` (`TimerReport` gains `confirmReminders`, `autoReleased`, `askedDone`, `sentToStaff`), `notify.ts`, `email.ts`, i18n; test `apps/web/tests/finish.int.spec.ts`.

**Interfaces:**
- Consumes: plan 2c's `settle`, `setGatewayForTests`, `fakeGateway`; Task 2 rules; plan 2a's `runDueTimers(exec, now)`, `notifyBookingEvent`.
- Produces: `FinishInputSchema {materialAmount?: number (0..booking amount)}`; `finishJob(tx, userId, bookingId, input: FinishInput, now = new Date()): Promise<Booking>` (provider only, `confirmed`, `now >= startAt`; sets `finished`, `finishedAt`, `confirmBy = finishedAt + 7d`, `materialAmount`; notifies `job-finished` with the release date); `confirmJob(tx, userId, bookingId, now = new Date()): Promise<Booking>` (customer only, from `finished`, or from `confirmed` once `askedDoneAt` is set; calls `releaseBooking`); `releaseBooking(exec: Exec, bookingId: string, now: Date): Promise<void>` (owner connection, locks the row, returns quietly when already `completed`; `settle(exec, id, amount)`, then `completed`, `completedAt`; notifies `payment-released` to both and `review-requested` for a root booking).
- Timers added to `runDueTimers`: confirm reminders (`dueConfirmReminder`, increments `confirmRemindersSent`, text says when the payment will be made); automatic release for `finished` past `confirmBy` without a dispute; `was-job-done` to the customer for `confirmed` bookings 24 hours after `endOf` (sets `askedDoneAt`); for `confirmed` bookings 7 days after `endOf` with no action, a `disputes` row with reason `no-response` and status `disputed`. A gateway error in one booking is logged and the sweep continues; the next run retries.
- [ ] **Step 1: Write tests** (fake gateway, pass `now`): `Finished before the start is 409; after it the 7-day clock starts`, `Finished twice is 409`, `reminders after 1, 3 and 6 days, each once`, `the customer confirms: one transfer, one commission row, status completed, both told`, `7 days of silence release automatically`, `confirm racing the timer settles once`, `24 hours after the end without Finished the customer is asked, once`, `the customer confirms from that question`, `7 days after the end with no action the booking goes to staff with a no-response dispute`, `a gateway failure leaves the booking finished and the next run releases it`.
- [ ] **Step 2: Run**: FAIL. **Step 3: Implement**. **Step 4: Run**: PASS.
- [ ] **Step 5: Commit** `feat: finished, confirmation and automatic release`.

### Task 4: Cancellation and no-shows

**Files:** Create `packages/domain/src/bookings/cancel.ts`; routes `bookings/[id]/cancel`, `bookings/[id]/no-show`, `bookings/[id]/no-show/object`; modify `endings.ts` contract, plan 2a's `timers.ts` (`noShowsResolved`), `public-profile.ts` (`reliability: number` from `provider_reliability`); test `apps/web/tests/cancel.int.spec.ts`.

**Interfaces:**
- Produces: `cancelBooking(tx, userId, bookingId, now = new Date()): Promise<Booking>` (from `confirmed`, before `startAt`; customer: `settle(customerCancelShare(...))`; provider: `settle(0)` and `lateCancel = isLate(...)`; status `cancelled`, `cancelledBy`; children: unpaid additional tasks are withdrawn, paid ones are cancelled by the same rule on their own amount); `reportNoShow(tx, userId, bookingId, now): Promise<Booking>` (from `confirmed` after `startAt`; sets `noShow` to the other side and `noShowReportedAt`; notifies them with the 48-hour objection deadline); `objectNoShow(tx, userId, bookingId, input: { description: string }, now)` (the reported side, within 48 hours: opens a dispute `no-show-objection`); timer: after 48 hours without objection, customer no-show `settle(amount)` and `cancelled`, provider no-show `settle(0)` and `cancelled`, then the provider no-show rule (first in 12 months: `provider-warning` notification; second: `flagForStaff({kind: 'provider-no-shows', refId: providerId})`).
- [ ] **Step 1: Write tests**: `customer cancels 25 hours before: full refund, no commission`, `customer cancels 23 hours before: provider share 50%, commission on that 50% only`, `provider cancels late: full refund and reliability count 1`, `cancelling after the start is 409 (use stop job or no-show)`, `customer no-show unanswered for 48 hours pays the provider in full`, `an objection within 48 hours opens a dispute and moves no money`, `a second provider no-show in 12 months flags staff`, `cancelling a booking with an unpaid and a paid additional task handles both`.
- [ ] **Step 2: Run**: FAIL. **Step 3: Implement**. **Step 4: Run**: PASS.
- [ ] **Step 5: Commit** `feat: cancellations and no-shows`.

### Task 5: Disputes and stop job

**Files:** Create `packages/domain/src/bookings/disputes.ts`, `stop.ts`; routes `bookings/[id]/dispute`, `bookings/[id]/stop`, `bookings/[id]/stop/amount`, `bookings/[id]/stop/answer`; modify `endings.ts` contract, plan 2b's `staffMayReadThread` (also true when the thread's booking or one of its additional tasks has a dispute), plan 2c's account-deletion refusal (adds `finished`, `stopped`, `disputed`), `timers.ts` (`stopsToStaff`, `overdueDisputes`); test `apps/web/tests/disputes.int.spec.ts`.

**Interfaces:**
- Produces: `DisputeInputSchema {description: text(1..2000)}`, `StopAmountInputSchema {amount: number, note?: text(..1000)}`, `StopAnswerSchema {agree: boolean}`; `openDispute(tx, userId, bookingId, input, now): Promise<Dispute>` (customer, `finished` and `now < confirmBy`; status `disputed`, `decideBy = addWorkingDays(now, 14)`; notifies both and the provider sees the description); `openSystemDispute(exec, bookingId, reason, now)` (used by Task 3, Task 4, `stop-disagreed`, and plan 2c's `chargeback` when the money is not yet released); `stopJob(tx, userId, bookingId, now)` (either side, `confirmed`; `stopped`, `stoppedBy`); `stateStopAmount(tx, userId, bookingId, input, now)` (provider, `0 <= amount <= booking amount`; the app offers hours times the service rate for hourly work and a percentage for fixed-price work, the server stores the amount); `answerStop(tx, userId, bookingId, answer)` (customer: agree, `releaseBooking` with `settle(stopAmount)`; disagree, `openSystemDispute('stop-disagreed')`). Timers: stated amounts unanswered for `STOP_ANSWER_DAYS` go to staff; disputes past `decideBy` raise one `dispute-overdue` flag; `ignoredNoticeFlags` (plan 2a's open item, my call): 14 days after a `requests-ignored` notice, a provider still published with no quote sent and no booking answered since then gets one `ignored-requests` flag (nothing is removed automatically).
- [ ] **Step 1: Write tests**: `the customer disputes within 7 days of Finished; the timer then releases nothing`, `a dispute after the 7 days is 409`, `dispute and auto-release race: exactly one outcome`, `either side can stop; the provider states 40 of 100; the customer agrees: refund 60, provider share 40, commission on 40`, `a stated amount above the price is 400`, `the customer disagrees: a stop-disagreed dispute`, `staff can read the thread of a disputed booking`, `decideBy skips weekends`, `a silent provider is flagged 14 days after the ignored-requests notice, once`.
- [ ] **Step 2: Run**: FAIL. **Step 3: Implement**. **Step 4: Run**: PASS.
- [ ] **Step 5: Commit** `feat: disputes and stop job`.

### Task 6: Additional task

**Files:** Create `packages/domain/src/bookings/additional.ts`; route `bookings/[id]/additional-task`; modify plan 2a's `acceptQuote` (branch for a request with `parentBookingId`), `sendQuote` (the quote card becomes plan 2b's `additional-task` card), `listBookings` (children nested under their parent), plan 2b's `threadForBooking`, i18n (`additionalTask.explainer`); test `apps/web/tests/additional-task.int.spec.ts`.

**Interfaces:**
- Produces: `AdditionalTaskInputSchema {description: text(1..2000)}`; `startAdditionalTask(tx, userId, bookingId, input, now): Promise<Request>` (customer's "Additional task" or provider's "Scope/quote review", on a `confirmed` or `finished` root booking; creates a `requests` row with `parentBookingId`, same customer, provider and service; posts an `additional-task` card in the parent's thread; the provider then quotes with plan 2a's `sendQuote`).
- `acceptQuote` for such a quote (my call): the time proposal is optional and defaults to the parent's start, duration, on-site choice and address; no time confirmation and no slot check; the booking is created `awaiting-payment` with `parentBookingId` and `payBy = now + ADDITIONAL_PAY_HOURS`. From there it is an ordinary booking: pay link (plan 2c), Finished, confirm, dispute, cancel and stop on its own.
- `additionalTask.explainer` (DE and EN) is shown on the card and the quote screen: work on the additional task starts only after it is accepted and paid; without that only the original job is owed.
- [ ] **Step 1: Write tests**: `either side starts an additional task; a card appears in the parent's thread`, `accepting its quote creates an awaiting-payment child with the parent's time`, `the child is paid, finished and released on its own clock`, `a dispute on the child freezes only the child`, `an additional task on a cancelled booking is 409`, `a third user gets 404`.
- [ ] **Step 2: Run**: FAIL. **Step 3: Implement**. **Step 4: Run** the file plus plan 2a's `requests-quotes.int.spec.ts`: PASS.
- [ ] **Step 5: Commit** `feat: additional tasks as linked bookings`.

### Task 7: Reviews and ratings on provider pages

**Files:** Create `packages/domain/src/reviews.ts`; routes `reviews/route.ts` (POST, GET mine), `reviews/[id]/route.ts` (PATCH); modify `public-profile.ts` and the public provider contract (`rating: {average: number; count: number} | null`, latest visible reviews), the website provider page and the mobile provider screen, plan 2a's request DTO for providers (the customer's rating), `timers.ts` (`reviewsShown`); test `apps/web/tests/reviews.int.spec.ts`.

**Interfaces:**
- Produces: `ReviewInputSchema {stars: int 1..5, text?: text(..2000)}`; `writeReview(tx, userId, bookingId, input, now): Promise<Review>` (a party of a `completed` root booking, within `REVIEW_VISIBLE_DAYS` of `completedAt`, once; `assertNoContactDetails` on the text; written on the owner connection; when the second review arrives both get `visibleAt = now` and `review-visible` goes to both); `editReview(tx, userId, reviewId, input, now)` (author, within `REVIEW_EDIT_DAYS` of `createdAt`, else 409 `REVIEW_FINAL`); `providerRating(exec, providerId): Promise<{ average: number; count: number } | null>` (visible, not hidden, `authorRole = 'customer'`; average to one decimal).
- [ ] **Step 1: Write tests**: `neither side sees the other's review until both are in`, `both appear together when the second is written`, `one review alone appears after 7 days`, `editing on day 14 works and on day 15 is 409`, `a review with a phone number is 422`, `a review on a cancelled or refunded booking is 409`, `the provider page shows average and count of visible customer reviews only`, `a hidden review leaves the average`.
- [ ] **Step 2: Run**: FAIL. **Step 3: Implement**. **Step 4: Run**: PASS.
- [ ] **Step 5: Commit** `feat: blind reviews and provider ratings`.

### Task 8: Back office: bookings, disputes, refunds, reviews

**Files:** Create `packages/domain/src/admin/bookings.ts`; routes `apps/web/app/api/admin/disputes/[id]/decide/route.ts`, `bookings/[id]/refund/route.ts`, `reviews/[id]/hide/route.ts`; pages `apps/web/app/admin/bookings/{page,show/[id]/page}.tsx`, `disputes/{page,show/[id]/page}.tsx`, `refunds/page.tsx`, `reviews/page.tsx`; modify `admin/resources.ts` (`roleFor`: Reviewers read bookings, disputes, refunds and reviews; decisions, refunds and hiding are Administrator only), `admin-shell.tsx`, admin i18n keys (German and English); test `apps/web/tests/admin-bookings.int.spec.ts`.

**Interfaces:**
- Consumes: plan 2c's `settle`, `paidAmount`, ledger; plan 2b's `staffThread`; Task 3 `releaseBooking`.
- Produces: `DisputeDecisionSchema {decision: 'full-payout'|'partial'|'full-refund', providerShare?: number, reason: text(10..2000)}` (`providerShare` required for `partial`, `0 < share < paid`); `decideDispute(exec, staffId, disputeId, input, now)` (settles with the share: full amount, the share, or 0; status `completed` or `refunded`; `dispute-decided` with the written reason to both); `staffRefund(exec, staffId, bookingId, input: { providerShare: number; reason: string })` (only for an unsettled paid booking; a refund after release is done in the Stripe dashboard and noted in the README); `hideReview(exec, staffId, reviewId, { hidden: boolean; reason: string })`.
- Screens: bookings list (filter by status, overdue disputes first) and detail (parties, times, amounts, ledger rows, additional tasks, the chat through `staffThread`); disputes list with `decideBy` and a decision form; refunds list (ledger `refund` rows); reviews list with hide and unhide.
- [ ] **Step 1: Write tests**: `an administrator decides partial 30 of 100: refund 70, commission on 30, both told with the reason`, `a partial larger than paid, negative, or with an empty reason is 400`, `a reviewer can read but not decide (403)`, `deciding twice is 409`, `hiding a review removes it from the provider page`.
- [ ] **Step 2: Run**: FAIL. **Step 3: Implement** in the existing resource and action-route style. **Step 4: Run**: PASS.
- [ ] **Step 5: Commit** `feat(admin): bookings, disputes, refunds and reviews`.

### Task 9: Mobile

**Files:** Modify `apps/mobile/src/api/bookings.ts` (+ test); create `apps/mobile/src/api/reviews.ts` (+ test), `apps/mobile/src/screens/bookings/{finish-sheet,dispute-form,stop-sheet,cancel-sheet}.tsx`, `apps/mobile/src/screens/reviews/review-form.tsx`; modify `booking-detail.tsx`, `provider-screen.tsx` (rating, reliability line), `apps/mobile/src/i18n/index.ts` (new error codes).

**Interfaces:**
- Produces in `api/bookings.ts`: `finishJob(id, input)`, `confirmJob(id)`, `cancelBooking(id)`, `reportNoShow(id)`, `objectNoShow(id, description)`, `openDispute(id, description)`, `stopJob(id)`, `stateStopAmount(id, input)`, `answerStop(id, agree)`, `startAdditionalTask(id, description)`; in `api/reviews.ts`: `writeReview(bookingId, input)`, `editReview(id, input)`, `myReviews()`.
- Booking detail shows the state in plain words ("The provider marked the job finished. The payment will be made on <date> unless you report a problem."), the cancellation price before the customer confirms ("Cancelling now is free" or "Cancelling now costs 50%: <amount>"), "Additional task" and "Scope/quote review" with the explainer, and the review form once completed.
- [ ] **Step 1: Write the API tests** (paths, methods, bodies). **Step 2: Run** `pnpm --filter mobile test`: FAIL. **Step 3: Implement**. **Step 4: Run** `pnpm --filter mobile test`, `npx tsc --noEmit`, `npx expo lint`: PASS.
- [ ] **Step 5: Commit** `feat(app): finish, confirm, cancel, dispute, stop, additional task and reviews`.

### Task 10: Check and report

**Files:** Create `Reports/Stage-2d-Test-Report.xlsx`; modify `README.md` ("What the app does today"; the 50% late-cancellation rule, the 48-hour no-show objection and the 7-day stop answer as rules to confirm; refunds after release are done in the Stripe dashboard).
- [ ] **Step 1: Run** `pnpm typecheck && pnpm lint && pnpm test`; record counts. **Step 2: Phone-test rows** (finish and confirm, silence with a shifted clock on the test database, cancel early and late, dispute and decide in the back office, stop job, additional task, reviews). **Step 3: Commit** `docs: stage 2d report and README`. The owner merges.

## Self-review

- **Spec coverage:** 3.5 Finished, 7 days, reminders 1/3/6, automatic release, payment-made message, reviews triggered: Task 3, 7; stop job: Task 5. 3.6 cancellation (24 hours, 50%, no-shows, provider late recorded, fee absorbed): Task 4. 3.7 disputes (window, freeze, 14 working days, three outcomes, written reason): Tasks 5, 8. 3.8 additional task as linked booking with its own payment, clock, payout and dispute, explainer, several lines per booking: Task 6 (invoices are plan 2e). 3.9 reviews: Task 7. 4 commission at release, only on the amount paid out: through `settle`. 7a provider never taps: Task 3. Staff back office for bookings, money state, disputes and refunds: Task 8. Plan 2a's open item "staff are told after 14 days" about the ignored-requests notice: Task 5's `ignoredNoticeFlags` timer.
- **Types:** plan 2a (`bookings`, `requests`, `quotes`, `canTransition`, `runDueTimers`, `TimerReport`, `acceptQuote`, `sendQuote`, `listBookings`, `notifyBookingEvent`), plan 2b (`threadForBooking`, `Card` `additional-task`, `staffMayReadThread`, `staffThread`, `flagForStaff`, `assertNoContactDetails`), plan 2c (`settle`, `paidAmount`, `OWNER_ONLY_BOOKING_STATUSES`, `fakeGateway`, `setGatewayForTests`, `commission_rate`) are used with their defined signatures. New names for plan 2e: `releaseBooking`, `materialAmount`, `parentBookingId`, `completedAt`, the notification kinds of Task 1.
- **Proportion:** ten tasks for five spec sections plus the back office; signatures, constants and tests only.
