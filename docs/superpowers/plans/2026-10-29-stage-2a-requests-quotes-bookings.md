# Stage 2a: requests, quotes and bookings (no money) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A customer can request a quote from a provider or book a fixed-price service; either way the customer proposes a date, time, duration and on-site or remote, the provider accepts or proposes another time, and the booking ends in "awaiting payment" (shown to others as "Pending booking"); everything that waits has a timer; nothing is charged.

**Architecture:** Three new private tables (`requests`, `quotes`, `bookings`) with row-level security for the two parties; pure rule functions (payment window, buffer overlap, state transitions) in `packages/domain/src/bookings/`; domain functions called from thin `/app-api/v1` routes; one cron route runs the timers with an injected clock. Payments, chat, finishing and reviews are later plans.

**Tech Stack:** existing: Drizzle + Postgres RLS (`packages/db`), zod contract (`packages/contract`), domain modules (`packages/domain`), Next.js route handlers (`apps/web`), Expo app (`apps/mobile`), vitest integration tests, jest for mobile.

**Spec:** `docs/superpowers/specs/2026-10-29-stage-2-booking-and-money-design.md` (sections 3.1 to 3.4, 3.11 is a later plan). Read `apps/web/AGENTS.md` and `apps/mobile/AGENTS.md` before writing Next or Expo code.

## Global Constraints

- Everything user-facing exists in German and English (`packages/i18n/src/en.ts` and `de.ts` must have the same keys; the test in `packages/i18n/src/index.test.ts` enforces it). No competitor names. No "Treuhand", "Escrow" or "Garantie" in any text.
- Money is `numeric(10,2)` plus `currency text default 'EUR'`; the contract currency stays `z.literal('EUR')`. No new Germany-only assumptions.
- Every new table is classified in `packages/db/src/rls.ts` (exactly one map) and gets an isolation test; `cleanupUsers()` in `apps/web/tests/helpers.ts` deletes from every new table first.
- Enums are `text` plus a `check(...)`, not Postgres enums. Migration numbers continue from `0011` (next is `0012`).
- Timing values (spec): provider answers a request within 3 days; a quote not accepted expires 7 days after it was sent, reminder 1 day before; a direct booking proposal lapses if the provider does not answer in 24 hours (foundation design); payment window = within 48 hours of acceptance but never later than 24 hours before the start, and 6 hours when the start is 24 hours or less away, reminders at about halfway and 3 hours before; 30 minutes free between on-site bookings; 3 expired requests in 30 days trigger the provider notice. Each value is one constant in `packages/domain/src/bookings/rules.ts`.
- Commits: no AI co-author or "Generated with" lines in pull requests; the owner merges every pull request; a test report goes in `Reports/`.

## Review Focus

- A request or booking for a provider who is unpublished or suspended: refused (404), not created.
- A customer requesting or booking their own service: refused (400).
- Two people acting at once (both accept the same pending time, provider accepts while the customer withdraws): exactly one wins; the loser gets 409 with no half-written row.
- A time in the past, a zero or huge duration, or a start more than a year away: 400.
- A timer run twice, or run late: the second run changes and notifies nothing (idempotent), and a late run still expires correctly.

## File structure

- `packages/db/src/schema/bookings.ts` (new): `requests`, `quotes`, `bookings`; export from `schema/index.ts`.
- `packages/db/migrations/0012_requests_quotes_bookings.sql` (generated) and `0013_notification_kinds.sql` (hand-written: widen the notification kind check).
- `packages/db/src/rls.ts`: classify the three tables; add `busy_times` definer function.
- `packages/contract/src/bookings.ts` (new): schemas, status lists, types; export from `index.ts`.
- `packages/domain/src/bookings/rules.ts`, `requests.ts`, `bookings.ts`, `busy.ts`, `timers.ts`, `notify.ts` (new); export from `packages/domain/src/index.ts`.
- `apps/web/app/app-api/v1/{requests,quotes,bookings}/**/route.ts`, `providers/[slug]/busy/route.ts`, `apps/web/app/api/cron/bookings/route.ts`, `apps/web/vercel.json`.
- `apps/mobile/src/api/bookings.ts`, `apps/mobile/src/screens/bookings/*`, routes under `apps/mobile/src/app/`.

### Task 1: Tables, migration and row-level security

**Files:** Create `packages/db/src/schema/bookings.ts`, the two migrations; modify `schema/index.ts`, `rls.ts`, `apps/web/tests/helpers.ts`; test `apps/web/tests/rls-bookings.int.spec.ts`.

**Interfaces:**
- Produces (columns the other tasks rely on):
  - `requests`: `id`, `customerId`, `providerId`, `serviceId` (nullable), `description`, `preferredDate` (nullable date), `status` check `open|quoted|booked|expired|withdrawn`, `answerBy` timestamptz, `createdAt`, `updatedAt`.
  - `quotes`: `id`, `requestId`, `providerId`, `version` int, `amount` numeric, `currency`, `scope`, `startAt` and `durationMin` (both nullable: a suggested time only), `status` check `sent|accepted|superseded|expired|declined`, `expiresAt`, `reminderSentAt` (nullable), `createdAt`.
  - `bookings`: `id`, `customerId`, `providerId`, `serviceId` (nullable), `quoteId` (nullable), `source` check `quote|direct`, `status` check `proposed|awaiting-payment|expired|declined|withdrawn`, `startAt`, `durationMin`, `amount`, `currency`, `onSite` boolean, `addressStreet`, `addressPostcode`, `addressCity`, `note`, `answerBy` (nullable), `payBy` (nullable), `counterBy` text (nullable, `'provider'|'customer'`), `remindedHalfAt`, `remindedLastAt` (nullable), `createdAt`, `updatedAt`.
- Notification kinds added: `request-received`, `quote-received`, `booking-proposed`, `booking-accepted`, `booking-declined`, `booking-expired`, `payment-reminder`, `quote-expiring`, `request-expired`, `requests-ignored`, `pending-slot-requested`.

- [ ] **Step 1: Write `rls-bookings.int.spec.ts`**: tests `a customer and the provider owner can read their request, quote and booking`, `a third user reads none of the three`, `app_user cannot insert a booking for another customer`, plus the existing `db-migrations.int.spec.ts` must still pass (classification).
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run tests/rls-bookings.int.spec.ts tests/db-migrations.int.spec.ts` and confirm failure (tables missing).
- [ ] **Step 3: Implement** the schema file in the existing style (uuid ids, `text('customer_id').references(() => users.id, { onDelete: 'cascade' })`, check constraints, indexes on `(provider_id, status)` and `(start_at)`); `pnpm db:generate` for `0012`; hand-write `0013`. In `rls.ts` classify all three in `PRIVATE_TABLES` with the party expression `customer_id = app_current_user_id() OR EXISTS (SELECT 1 FROM providers p WHERE p.id = provider_id AND p.owner_id = app_current_user_id())` (for `quotes` use the same on its own columns). My call: status columns stay writable by the two parties (transitions are enforced in the domain, tested in Task 3); money columns become staff-only in the payments plan.
- [ ] **Step 4: Add the three tables to `cleanupUsers()`** before `providers`, then run the Step 2 command: expected PASS.
- [ ] **Step 5: Commit** `feat(db): requests, quotes and bookings with row-level security`.

### Task 2: Contract

**Files:** Create `packages/contract/src/bookings.ts`; modify `index.ts`; test `packages/contract/src/bookings.test.ts`.

**Interfaces:**
- Produces: `RequestInputSchema {providerId, serviceId?, description(1..2000), preferredDate?}`, `RequestSchema`, `QuoteInputSchema {amount, scope(1..2000), startAt?, durationMin?(15..720)}`, `QuoteSchema`, `TimeProposalSchema {startAt, durationMin(15..720), onSite: boolean, address?:{street?,postcode,city?}, note?}` (address required when `onSite`), `AcceptQuoteInputSchema = TimeProposalSchema`, `DirectBookingInputSchema = TimeProposalSchema + {serviceId}`, `BookingAnswerSchema` (discriminated union on `type`: `accept` | `decline` | `counter {startAt, durationMin, onSite}`), `BookingSchema` (includes `payBy`, `state: 'pending'|...` is NOT stored; the DTO has `status`), `BusyTimeSchema {startAt, endAt, state: 'pending'|'booked'}`; status constant arrays `REQUEST_STATUSES`, `QUOTE_STATUSES`, `BOOKING_STATUSES`.
- [ ] **Step 1: Write tests** `rejects a start that is not an ISO datetime`, `rejects duration 0 and 721`, `accepts address with postcode only`, `an on-site proposal without an address is rejected and a remote one without an address is accepted`, `BookingAnswerSchema parses counter and rejects a counter without startAt`.
- [ ] **Step 2: Run** `pnpm --filter @kando/contract test`: FAIL.
- [ ] **Step 3: Implement** following `contract/src/common.ts` helpers (`AmountSchema`, `CurrencySchema`, `text(n)`); "in the past" is checked against the supplied `now` in the domain, the schema only requires an ISO datetime.
- [ ] **Step 4: Run**: PASS (the past-time check lives in the domain, Task 3, not in the schema).
- [ ] **Step 5: Commit** `feat(contract): request, quote and booking schemas`.

### Task 3: Rules (pure functions)

**Files:** Create `packages/domain/src/bookings/rules.ts`; test `packages/domain/src/bookings/rules.test.ts` (unit, no database; add the test script to `packages/domain/package.json` if absent).

**Interfaces:**
- Produces: constants `REQUEST_ANSWER_DAYS=3`, `QUOTE_VALID_DAYS=7`, `PROPOSAL_ANSWER_HOURS=24`, `BUFFER_MINUTES=30`, `IGNORED_LIMIT=3`, `IGNORED_WINDOW_DAYS=30`; `payBy(acceptedAt: Date, startAt: Date): Date`; `overlaps(a: Span, b: Span, bufferMin: number): boolean` where `Span = {start: Date; end: Date}`; `canTransition(from: BookingStatus, to: BookingStatus): boolean`; `assertFuture(startAt: Date, now: Date): void` (throws `fail(400, ...)` for the past or more than 365 days ahead).
- [ ] **Step 1: Write tests** with the spec's values: `payBy` accepted Monday 10:00, start Friday 10:00 returns Wednesday 10:00; accepted Monday 10:00, start Wednesday 10:00 returns Tuesday 10:00 (start minus 24h); accepted 10:00, start next day 09:00 (23h away) returns 16:00 (6h); `overlaps` with 30 minutes buffer: 10:00-11:00 vs 11:20-12:00 true, vs 11:30-12:00 false, buffer 0 true only on real overlap; `canTransition('proposed','awaiting-payment')` true, `('expired','awaiting-payment')` false, `('awaiting-payment','proposed')` false.
- [ ] **Step 2: Run** `pnpm --filter @kando/domain test`: FAIL.
- [ ] **Step 3: Implement** the signatures; transitions allowed: proposed to awaiting-payment, expired, declined, withdrawn, and proposed to proposed (counter); awaiting-payment to expired, withdrawn.
- [ ] **Step 4: Run**: PASS. **Step 5: Commit** `feat(domain): booking timing and transition rules`.

### Task 4: Requests and quotes

**Files:** Create `packages/domain/src/bookings/requests.ts`; routes `apps/web/app/app-api/v1/requests/route.ts`, `requests/[id]/route.ts`, `requests/[id]/quotes/route.ts`, `quotes/[id]/accept/route.ts`; test `apps/web/tests/requests-quotes.int.spec.ts`; modify `domain/src/index.ts`.

**Interfaces:**
- Consumes: Task 2 schemas, Task 3 rules, `fail`, `ownProvider`, `offerableServiceIds`, `isSuspendedNow` from existing code.
- Produces: `createRequest(tx, userId, input: RequestInput, now = new Date()): Promise<Request>`, `listRequests(tx, userId, role: 'customer' | 'provider'): Promise<Request[]>`, `sendQuote(tx, userId, requestId: string, input: QuoteInput, now = new Date()): Promise<Quote>` (a new version supersedes the previous `sent` one), `acceptQuote(tx, userId, quoteId: string, input: AcceptQuoteInput, now = new Date()): Promise<Booking>` (marks the quote `accepted` and the request `booked`, and creates a booking in `proposed` status from the customer's time proposal; the provider then answers it with Task 5's `answerBooking`, exactly as for a direct booking).
- Owner decision: accepting a quote does not agree the time; the date-and-time confirmation is the same proposal-and-answer step as for a direct booking. `onSite` must be true when the provider does not work remotely. `canTransact(provider)` is not needed yet (payout set-up is the payments plan).

- [ ] **Step 1: Write tests**: `customer creates a request; provider sees it incoming`, `request to an unpublished or suspended provider is 404`, `own service request is 400`, `provider sends a quote; a second quote supersedes the first`, `customer accepts the quote with a time proposal and gets a proposed booking (no payBy yet)`, `a quote's suggested time can be kept or replaced by the customer`, `onSite false is refused when the provider does not work remotely`, `accepting an expired quote is 409`, `two concurrent accepts: one 200, one 409` (use `Promise.all` and `lockProfile`-style advisory lock on the request id), `a third user gets 404 on every route`.
- [ ] **Step 2: Run** the file: FAIL. **Step 3: Implement** the four functions and the routes in the `appRequest({auth:'required'})` pattern (`parseBody`, 201 on create); derive the provider from `ownProvider(tx, userId)`, never from the body.
- [ ] **Step 4: Run**: PASS. **Step 5: Commit** `feat: requests and quotes`.

### Task 5: Direct booking

**Files:** Create `packages/domain/src/bookings/bookings.ts`; routes `bookings/route.ts` (POST create, GET list), `bookings/[id]/answer/route.ts`, `bookings/[id]/withdraw/route.ts`; test `apps/web/tests/bookings.int.spec.ts`.

**Interfaces:**
- Produces: `createDirectBooking(tx, userId, input: DirectBookingInput, now?): Promise<Booking>` (only for a service with `priceType === 'fixed'` that is offerable; amount copied from the service; `onSite` comes from the customer's proposal and must be true when the provider does not work remotely; status `proposed`, `answerBy = now + 24h`); `answerBooking(tx, userId, bookingId, answer: BookingAnswer, now?): Promise<Booking>` (works for bookings from a quote and direct ones alike; provider `accept` runs `assertSlotFree` (Task 6), sets `awaiting-payment` and `payBy`; `decline`; `counter` keeps `proposed`, sets `counterBy='provider'` and the new time and on-site or remote choice; the customer answering a counter with `accept` does the same as a provider accept, and the customer can counter back); `withdrawBooking(tx, userId, bookingId): Promise<Booking>` ("I no longer need this", customer only, from `proposed` or `awaiting-payment`); `listBookings(tx, userId, role)`.
- [ ] **Step 1: Write tests**: `hourly or on-request service cannot be booked directly (400)`, `provider accepts a booking made from an accepted quote the same way as a direct one: status awaiting-payment and payBy set`, `provider counters; customer accepts the counter`, `only the provider can accept a customer proposal and only the customer a provider counter (403/404 otherwise)`, `customer withdraws an awaiting-payment booking and the slot is free again`, `job address is hidden from the provider until accepted` (provider's DTO has `address: null` while `proposed`).
- [ ] **Step 2: Run**: FAIL. **Step 3: Implement** with `canTransition` guarding every status change and a `SELECT ... FOR UPDATE` on the booking row. **Step 4: Run**: PASS. **Step 5: Commit** `feat: direct booking`.

### Task 6: Pending booking, buffer and first come, first served

**Files:** Create `packages/domain/src/bookings/busy.ts`; modify `rls.ts` (definer function `busy_times(p_provider uuid, p_from timestamptz, p_to timestamptz)` returning only `start_at`, `end_at`, `state`, `REVOKE ALL FROM PUBLIC`, `GRANT EXECUTE TO app_user`, `SET search_path = public, pg_temp`), route `providers/[slug]/busy/route.ts` (auth optional); replace the stub in Task 4; test `apps/web/tests/busy-times.int.spec.ts`.

**Interfaces:**
- Produces: `busyTimes(tx, slug: string, from: Date, to: Date): Promise<BusyTime[]>`; `assertSlotFree(tx, providerId: string, startAt: Date, durationMin: number, onSite: boolean, ignoreBookingId?: string): Promise<void>` (throws 409 when an `awaiting-payment` booking overlaps with the buffer, using `overlaps()`; `proposed` bookings do not block).
- Rules from the spec: `awaiting-payment` shows as `pending`; a request on a pending time is allowed and notifies the provider (`pending-slot-requested`, via Task 8); the provider cannot accept it while the first is still `awaiting-payment` (409 with the message key `booking.slotPending`); it becomes acceptable when the first expires or is withdrawn.
- [ ] **Step 1: Write tests**: `busy times show pending and booked ranges but no names or ids`, `an anonymous caller can read them`, `a booking 20 minutes after an on-site pending one conflicts, 30 minutes after does not`, `a remote booking has no buffer, even for a provider who also works on-site`, `provider cannot accept a second proposal on a pending time (409); after the first is withdrawn it works`, `a second request on a pending time creates a pending-slot-requested notification for the provider`.
- [ ] **Step 2: Run**: FAIL. **Step 3: Implement**; the conflict check runs inside the same transaction as the status change, under an advisory lock keyed on the provider id (`pg_advisory_xact_lock(hashtext('booking_slot'), hashtext(providerId))`). **Step 4: Run**: PASS. **Step 5: Commit** `feat: pending bookings, buffer and first come first served`.

### Task 7: Timers and the ignored-requests notice

**Files:** Create `packages/domain/src/bookings/timers.ts`, `apps/web/app/api/cron/bookings/route.ts`; modify `apps/web/vercel.json`; test `apps/web/tests/timers.int.spec.ts` and `cron-bookings.int.spec.ts` (copy the bearer-token tests from `cron-suspensions.int.spec.ts`).

**Interfaces:**
- Produces: `runDueTimers(exec: Exec, now: Date): Promise<TimerReport>` where `TimerReport = { requestsExpired: number; quotesExpired: number; proposalsLapsed: number; unpaidExpired: number; remindersSent: number; ignoredNotices: number }`. It: expires `open` requests past `answerBy` (notifies the customer: the provider is not available at the moment, please contact a different provider); expires `sent` quotes past `expiresAt`; lapses `proposed` bookings past `answerBy`; expires `awaiting-payment` bookings past `payBy`; sends the quote reminder 1 day before expiry and the payment reminders at the halfway point and 3 hours before `payBy` (each once, using the `reminded*` columns); and, when a provider has `IGNORED_LIMIT` expired requests in the last `IGNORED_WINDOW_DAYS`, sends the provider one `requests-ignored` notice (dedupe: none already created in that window) asking them to confirm they want to stay or withdraw their services (my call: no automatic removal; staff are told after 14 days by a later task).
- Schedule: `vercel.json` gets `{"path":"/api/cron/bookings","schedule":"0 * * * *"}` (hourly needs the Pro plan, already a launch step; on the free plan only daily runs work, so also call `runDueTimers` lazily from `listBookings`/`listRequests` for the caller's own rows so a late sweep never shows stale statuses).
- [ ] **Step 1: Write tests** (pass `now`): `a request open 3 days and 1 minute expires and the customer is notified`, `three expired requests in a month create exactly one requests-ignored notice`, `running the timers twice changes nothing the second time`, `a run two days late still expires correctly`, `quote reminder is sent once, one day before expiry`, `unpaid awaiting-payment past payBy expires and frees the time`, cron route `401 without the bearer token`.
- [ ] **Step 2: Run**: FAIL. **Step 3: Implement** each rule as one `UPDATE ... RETURNING` on the owner connection so a concurrent run cannot double-process. **Step 4: Run**: PASS. **Step 5: Commit** `feat: booking timers, reminders and the ignored-requests notice`.

### Task 8: Notifications and emails

**Files:** Create `packages/domain/src/bookings/notify.ts`; modify `notifications-store.ts` (widen the `kind` literal to the Task 1 list), `email.ts` (templates `request-received`, `quote-received`, `booking-accepted`, `payment-reminder`, `quote-expiring`, `request-expired`, `requests-ignored`, with fixed placeholders only: reuse `{date}` and `{url}`), `packages/i18n/src/en.ts` and `de.ts` (keys `email.<name>.subject/.body`, `notification.<kind>`).

**Interfaces:**
- Produces: `notifyBookingEvent(kind: NotificationKind, userId: string, params: Record<string, string>): Promise<void>` following `notifyXxx` in `notifications.ts` (loads the user's language on `db`, never throws, runs in `afterCommit`).
- The `requests-ignored` text explains why ignoring requests hurts the provider (customers leave, the app shows them as unavailable) and asks them to confirm they want to stay or withdraw their services. The customer's `request-expired` text says the provider is not available at the moment and to contact a different provider. The quote screen and `quote-received` email state the 7-day expiry (spec 3.1).
- [ ] **Step 1: Write tests** in `apps/web/tests/booking-notifications.int.spec.ts`: each event stores one in-app notification and one outbox email in the user's language (`outboxForTests()`), the quote-received email contains the expiry date, and `index.test.ts` (i18n parity) passes.
- [ ] **Step 2: Run**: FAIL. **Step 3: Implement**; wire the calls into Tasks 4 to 7 through `afterCommit`. **Step 4: Run** `pnpm --filter web test` and `pnpm --filter @kando/i18n test`: PASS. **Step 5: Commit** `feat: booking notifications and emails`.

### Task 9: Mobile screens

**Files:** Create `apps/mobile/src/api/bookings.ts` (+ `bookings.test.ts`), `apps/mobile/src/screens/bookings/{request-form,my-bookings,booking-detail,quote-card}.tsx`, routes `apps/mobile/src/app/bookings/**`; modify `provider-screen.tsx` (replace the disabled "Send request" button: fixed-price services show "Book", others "Request a quote"; a "Busy times" list from the busy route when proposing a time), `apps/mobile/src/i18n/index.ts` (error mapping for the new 409/404 keys), the account or home tab entry to reach "My bookings".

**Interfaces:**
- Consumes: the routes of Tasks 4 to 6 and the contract types. Produces: `createRequest`, `sendQuote`, `acceptQuote`, `createDirectBooking`, `answerBooking`, `withdrawBooking`, `listBookings`, `getBusyTimes` in `api/bookings.ts`, each a thin `api<T>(path, json(method, body))` call like `api/my-profile.ts`.
- [ ] **Step 1: Write `bookings.test.ts`** asserting each call's path, method and body (pattern of `api/my-profile` tests). **Step 2: Run** `pnpm --filter mobile test`: FAIL. **Step 3: Implement** the API module, then the screens (text from `@kando/i18n`, German and English); the booking detail shows the status in plain words ("Waiting for the provider", "Waiting for your payment, pay by <date>"), the 7-day quote expiry on the quote card, and "I no longer need this". The pay link is a placeholder row until the payments plan. **Step 4: Run** `pnpm --filter mobile test`, `npx tsc --noEmit` and `npx expo lint` in `apps/mobile`: PASS. **Step 5: Commit** `feat(app): requests, quotes and bookings screens`.

### Task 10: Whole-stage check and report

**Files:** Create `Reports/Stage-2a-Test-Report.xlsx` (same sheets as earlier reports: tests, other checks "Not yet done" for phone, open items); modify `README.md` ("What the app does today", "Not built", START HERE).
- [ ] **Step 1: Run** `pnpm typecheck && pnpm lint && pnpm test` and record the counts. **Step 2: Add** the phone-test checklist rows (request, quote, accept, direct booking, counter, withdraw, expiry text visible). **Step 3: Update the README** (the "Send request" button is replaced; payment is still not possible). **Step 4: Commit** `docs: stage 2a report and README`. The owner merges.

## Self-review

- **Spec coverage:** 3.1 (request, quote, 3-day answer, 7-day expiry shown, ignored notice, customer notice): Tasks 4, 7, 8, 9. 3.2 direct booking, fixed price only: Task 5. 3.3 pending, buffer, first come: Task 6, and the date-and-time confirmation for quote and direct bookings alike: Task 5. 3.4 payment window and reminders: Tasks 3, 7 (the payment itself is plan 3). Not in this plan, by design: chat, photos on requests (they arrive with the chat plan, my call), payment, finishing, disputes, cancellation, reviews, "Notify me when available", invoices.
- **Types:** `Booking`, `Quote`, `Request`, `BusyTime`, `BookingAnswer` are defined in Task 2 and used unchanged in Tasks 4 to 9; `payBy`, `overlaps`, `canTransition`, `assertSlotFree` signatures are the same where used.
- **Proportion:** each task names files, signatures, values and tests; bodies are left to the implementer.
