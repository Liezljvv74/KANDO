# Assessment fixes, Stage B: server flow and efficiency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No quote-born job is lost when its time is not agreed, customers can withdraw and providers can decline a request, either side can open a dispute after Finished or Stop, emails and pushes go out after the answer and are never lost by a cut-off cron run, lists are paged with read-one routes, search pages in SQL and shows ratings, the public site is cached, the daily cron is split, and currency and search country come from the country.

**Architecture:** Two SECURITY DEFINER triggers in `packages/db/src/rls.ts` carry the request and quote side effects of every path at once (a request closed by its customer or provider closes its sent quote; a quote-born root booking that ends `declined|expired|withdrawn` reopens its request and quote), so the domain, the timers and account code need no copies. Network sends (Resend, Expo) are collected in an `AsyncLocalStorage` scope during a request and handed to an injected scheduler, which the web app sets to Next's `after()`; the timers write their in-app rows with `mailed_at` NULL and a drain step sends them, so a cut-off run leaves the rest for the next run. One migration, `0023`, carries all of this stage's schema.

**Tech Stack:** existing stack (Next.js 16.4 `after()` and ISR, Drizzle, Postgres/PostGIS, Expo with jest); nothing new installed.

**Spec:** `docs/superpowers/specs/2026-10-30-assessment-findings.md` (items 2, 7, 21, 22, 23, 24, 25, 32). Builds on the Stage A plan `docs/superpowers/plans/2026-10-30-assessment-stage-a-database-connections.md` (migration 0022: the `providers.location` GiST index, the cron partial indexes, the status guard). Read `apps/web/AGENTS.md` and `apps/mobile/AGENTS.md` first.

## Findings covered (verified in code on `release/assessment-fixes` at 7617df9)

- **2 confirmed.** `packages/domain/src/bookings/requests.ts:253-254` sets the quote `accepted` and the request `booked`; `bookings.ts:101-104` (decline), `bookings.ts:131-137` (withdraw) and `timers.ts:98-110` (lapsed proposal, unpaid expiry) never touch them again, so `sendQuote` (`requests.ts:194`) and `acceptQuote` (`:235`) refuse for good.
- **7 confirmed.** `packages/domain/src/app-request.ts:79` runs the after-commit queue before `return response`; `finish.ts:51`, `stop.ts:34,62`, `disputes.ts:117`, `cancel.ts:71,139,163,192`, `additional.ts:72`, `admin/bookings.ts:42-47,160` send inline while the request transaction is open; `email.ts:107` calls Resend with no timeout; `timers.ts:324-327` sends every event serially after the money loop, so a run cut off at 60 s drops the rest (their in-app rows exist, the emails never go).
- **21 confirmed.** `bookings.ts:66-74`, `requests.ts:152-157`, `chat/threads.ts:66-80` return everything; no `GET bookings/[id]` or `GET threads/[id]` route exists; mobile `booking-detail.tsx:31-37` downloads both booking lists to find one, `thread.tsx:24-27` and `api/chat.ts:17-24` download all threads. Messages are already paged (`chat/messages.ts:56`).
- **22 confirmed.** `search.ts:70-80` loads up to `MAX_CANDIDATES = 500` rows, evaluates `offerable_service_ids` per candidate, ranks in JS and slices (`:99`), so providers beyond 500 never show; `search.ts:135` and `public-profile.ts:96` set `isNew: true` for everyone although `ratingsOf` exists (`reviews.ts:101`).
- **23 confirmed.** `apps/web/app/(site)/layout.tsx:14` reads `headers()` (the proxy's `x-lang`), and every page reads `searchParams.lang`: the whole site renders per visitor.
- **24 confirmed.** `timers.ts:337-355`: one function, one `RELEASE_BUDGET_MS = 30_000` for everything; invoices and commission invoices get what is left after the releases. Never cleaned up: `notifications`, `stripe_events`, `push_tokens` (stale devices). `contact_attempts` is left to Stage C (item 28, blocked text kept forever); `staff_access_log` is an audit log and stays.
- **25 confirmed.** No `requests/[id]/withdraw|decline` routes; `REQUEST_STATUSES` (`packages/contract/src/bookings.ts:7`) has no `declined`; `openDispute` (`disputes.ts:104`) refuses the provider and refuses `stopped`; mobile `lib/booking-status.ts:96-102` offers `dispute` to the customer only.
- **32 confirmed.** `requests.ts:208` and `:219` (the chat card) hard-code `'EUR'`; `search.ts:37,134,144` and `packages/contract/src/providers.ts:34` default the country to `'DE'`; `countries` has no currency column.

## Global Constraints

- Branch `assessment-b-server-flow` from `release/assessment-fixes` after Stage A is merged; pull request into `release/assessment-fixes`; the owner merges. Commit messages carry no AI co-author or "Generated with" lines.
- TDD: every task starts with a failing test. Web integration specs in `apps/web/tests` (vitest, Docker Postgres on 5433: `docker compose up -d --wait db`, run with `pnpm --filter web exec vitest run <file>`); domain, contract, i18n: vitest; mobile: jest (`pnpm --filter mobile test`). Typecheck with `npx tsc --noEmit` in each touched package directory.
- Migration `0023` only (Stage A owns `0022`). Generate with `pnpm db:generate`, then hand-edit as the steps say. Stage A's rule (`migrate.ts` comment): the migrator runs all pending files in one transaction, so no `CONCURRENTLY`; a widened status or kind `CHECK` is `DROP CONSTRAINT …; ADD CONSTRAINT … CHECK (…) NOT VALID` with **no** `VALIDATE`. Stage A created every index in 0022: this stage adds **no index** (the outbox and offerable lookups run on small tables and on the existing `services_provider_id_idx`; ponytail note in the report). Triggers and functions go in `rls.ts` (re-applied on every `pnpm db:migrate`), never in the migration.
- Connections (Stage A): `db`/`pool` is the owner connection, `appDb`/`appPool` serves `asUser` only. A handler may return an `AfterTransaction` (`() => Promise<Response>`) that the wrapper calls after commit; this stage only moves the after-commit queue and the sends behind `after()`.
- Every user-facing text in German and English (`packages/i18n/src/de.ts`, `en.ts`); every notification kind has an in-app text, a push title and body and an email template in both languages (`apps/web/tests/notification-parity.int.spec.ts`); push texts carry no digits, `{}`, `€` or `@`. Never "Treuhand", "Escrow", "Garantie". No competitor names.
- Germany-agnostic: no new `'DE'` or `'EUR'` literals in code paths; the country decides.
- Do not refactor `lockRow`, `partyOf`/`sideOf`, `notFound`, `HOUR`/`DAY`/`NO_ID` (Stage D, item 30), and add no new copies of them: import the existing ones (`finish.ts` exports `lockRow`, `sideOf`).
- Status moves made by the app role go into Stage A's `APP_STATUS_MOVES.requests` in `rls.ts`: `'open>withdrawn': 'customer'`, `'quoted>withdrawn': 'customer'`, `'open>declined': 'provider'`, `'quoted>declined': 'provider'` (Task 4). The side effects (request `booked > quoted`; quote `accepted > sent|expired`, `sent > declined`) run inside this stage's SECURITY DEFINER triggers, where `current_user` is the table owner, so Stage A's `app_status_guard` (app role only) does not apply and **no entry is added for them**: an entry would let a customer set `booked > quoted` by hand. `requests.answer_by` is never changed (Stage A forbids it to the app role): a reopened request is re-quotable while its quote lives, exactly like a quoted request today.
- No new dependency. Next's `after` and `revalidatePath` come with `next`.

## Review Focus

- A customer withdraws a request at the same moment the provider sends a quote: never a `sent` quote on a withdrawn request (Task 4 test `withdraw racing sendQuote leaves no sent quote`).
- A quote that expires in the very second its booking lapses: the request is `quoted`, the quote `expired`, and acceptQuote answers 409 `quote-expired`, not 500 (Task 5 test `reopen at the quote's expiry keeps the quote expired`).
- A request fails after an owner-connection step already committed (finishJob, openDispute): the notices of that step still go out, after the answer (Task 2 test `notices of a committed owner step go out when the request then fails`).
- Two bookings with the same `created_at` on a page boundary: none lost, none twice; a forged cursor is 400 (Task 7 tests `cursor pages over equal createdAt without loss`, `a bad cursor is 400`).
- A category gains a required document, or an approved document is deleted: the provider leaves search at once (Task 9 test `a new required document removes the services from search at once`).

## File structure

- `packages/db/src/schema/bookings.ts`, `notifications.ts`, `providers.ts` (services), `reference.ts` (countries): Task 1 columns and checks; `packages/db/migrations/0023_*.sql` (generated, hand-edited).
- `packages/db/src/rls.ts`: triggers `requests_close_quotes`, `bookings_reopen_request` (Tasks 4, 5); offerable triggers and the rewritten `offerable_service_ids` (Task 9); `services.offerable` in `COLUMN_STAFF_ONLY` (Task 9).
- `packages/domain/src/deferred-sends.ts` (new, Task 2), `email.ts`, `push.ts`, `app-request.ts` (tail only).
- `packages/domain/src/bookings/outbox.ts` (new, Task 3), `retention.ts` (new, Task 3), `bookings/timers.ts`, `bookings/notify.ts`.
- `packages/domain/src/bookings/requests.ts`, `bookings.ts`, `disputes.ts`, `chat/threads.ts`, `search.ts`, `public-profile.ts`.
- `packages/contract/src/bookings.ts`, `me.ts`, `providers.ts`, `chat.ts`, `common.ts`.
- `apps/web/lib/after-response.ts` (new), `apps/web/lib/cron.ts` (new), `apps/web/lib/public-cache.ts` (new), `app-request.ts`, `admin-request.ts`, `proxy.ts`, `vercel.json`, cron routes, new app-api routes, `app/(site)/**` moved under `app/(site)/[lang]/`.
- Mobile: `src/api/bookings.ts`, `src/api/chat.ts`, `src/lib/booking-status.ts`, `src/lib/notification-text.ts`, `src/screens/bookings/{booking-detail,request-detail,my-bookings}.tsx`, `src/screens/chat/{thread,thread-list}.tsx`, `src/screens/search/provider-card.tsx`, `src/screens/provider/provider-screen.tsx`.

---

### Task 1: Migration 0023, contract enums and texts

**Files:** Modify `packages/db/src/schema/{bookings,notifications,providers,reference}.ts`; create `packages/db/migrations/0023_*.sql`; modify `packages/contract/src/{bookings,me}.ts`, `packages/i18n/src/{de,en}.ts`, `packages/domain/src/email.ts` (`EMAIL_KEYS`), `apps/mobile/src/lib/notification-text.ts` (`KEY`); test `apps/web/tests/db-migrations.int.spec.ts`, `notification-parity.int.spec.ts`.

**Interfaces:**
- Produces: `requests_status_check` adds `'declined'`; `REQUEST_STATUSES` adds `'declined'`.
- Produces: `notifications_kind_check` and `NOTIFICATION_KINDS` add `'request-withdrawn'` (to the provider owner, payload `{ requestId }`), `'request-declined'` (to the customer, `{ requestId }`), `'request-reopened'` (to the customer, `{ requestId, bookingId }`; email date = the quote's expiry).
- Produces: `notifications.mailed_at timestamptz DEFAULT now()` (nullable; NULL = waiting in the outbox; existing rows get the default). No index (Global Constraints).
- Produces: `services.offerable boolean NOT NULL DEFAULT false`, backfilled in the migration with the same rule as today's `offerable_service_ids` minus the publish and suspension condition (priced, and every required document of the category approved for the provider's owner). No index.
- Produces: `countries.currency text REFERENCES currencies(code)`: added nullable, `UPDATE countries SET currency = 'EUR' WHERE code = 'DE'`, then `SET NOT NULL`.
- Texts (English intent; German written to match, flagged for the native read): `request-withdrawn` "The customer withdrew their request."; `request-declined` "The provider cannot take this request. Try another provider."; `request-reopened` "The time was not agreed. The quote is open again until {date}: propose another time." (in-app and push without the date); `requestStatus.declined` "Declined".

- [ ] **Step 1: Write the failing tests**: in `db-migrations.int.spec.ts` add `0023: requests accept declined, notifications have mailed_at, services have offerable, every country has a currency` (insert a request with status `declined` passes; `SELECT currency FROM countries WHERE code = 'DE'` is `'EUR'`; an existing notification row has `mailed_at` not null). The parity spec fails on its own once the kinds are in the contract without texts.
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run tests/db-migrations.int.spec.ts tests/notification-parity.int.spec.ts`: FAIL.
- [ ] **Step 3: Implement**: schema, `pnpm db:generate`, hand-edit the SQL (the two widened CHECKs as `NOT VALID` without `VALIDATE`, the backfill `UPDATE services`, the currency steps); contract lists; `EMAIL_KEYS` `'request-withdrawn': 'email.requestWithdrawn'` etc.; DE/EN `notification.*`, `push.*.title|body`, `email.*.subject|body`, `requestStatus.declined`; mobile `KEY` entries (`notification.requestWithdrawn` ...). Run `pnpm db:migrate` against the Docker database.
- [ ] **Step 4: Run** the two specs, then `npx tsc --noEmit` in `packages/contract`, `packages/domain`, `apps/web`, `apps/mobile`: PASS.
- [ ] **Step 5: Commit** `feat(db): migration 0023 for the assessment stage B`.

### Task 2: Sends after the answer, Resend timeout (item 7)

**Files:** Create `packages/domain/src/deferred-sends.ts`, `apps/web/lib/after-response.ts`; modify `packages/domain/src/{email,push,app-request,index}.ts`, `apps/web/lib/{app-request,admin-request}.ts`; test `apps/web/tests/app-request.int.spec.ts`, `email.int.spec.ts`.

**Interfaces:**
- Produces: `withDeferredSends<T>(sends: (() => Promise<void>)[], fn: () => Promise<T>): Promise<T>` (runs `fn` in an `AsyncLocalStorage` scope; the caller owns the array, so it survives a throw) and `deferSend(fn: () => Promise<void>): boolean` (true = queued in the active scope).
- `sendEmail` and `sendPush` (and the batch path in `push.ts`) first call `deferSend(() => <the real send>)` and return when it queued; the queued closure calls the non-deferring inner function (the closure may run outside the scope).
- Produces: `export type Schedule = (work: () => Promise<void>) => void | Promise<void>`; `createAppRequest(getSession: SessionResolver, opts?: { schedule?: Schedule })`, default `(w) => w()` awaited (domain tests and scripts behave as today). The `withDeferredSends` scope covers the transaction and Stage A's `AfterTransaction` call. After the answer is known: one scheduled job runs the after-commit queue, then the collected sends. On failure: the fail queue as today, then the collected sends are scheduled too (they belong to owner-connection steps that already committed). Only the tail of `app-request.ts` changes (Stage A owns the connection part, Stage C the body-size part).
- Produces: `afterResponse: Schedule` in `apps/web/lib/after-response.ts`: `after(work)` from `next/server`; when `after` throws (no request scope: vitest calls routes directly) it returns `work()` so tests see the sends. `adminRequest` gets the same scope and schedule.
- `EMAIL_TIMEOUT_MS = 10_000` in `email.ts`: the Resend call races a timer; on timeout log `[email] send failed timeout` (never the address), never throw.

- [ ] **Step 1: Write the failing tests**: `the response is returned before after-commit work and sends run` (a `createAppRequest(resolver, { schedule })` whose `schedule` stores the job: the response is back, the outbox is empty, running the job fills it); `notices of a committed owner step go out when the request then fails` (handler calls `finishJob` then throws: response 500, scheduled job sends `job-finished`); `a Resend call that hangs ends after EMAIL_TIMEOUT_MS` (`vi.mock('resend')` with a never-resolving `emails.send`, fake timers: `sendEmail` resolves, the log line says timeout).
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run tests/app-request.int.spec.ts tests/email.int.spec.ts`: FAIL.
- [ ] **Step 3: Implement** as in Interfaces. Read `node_modules/next/dist/docs` on `after` first (run `pnpm install` if `apps/web/node_modules/next` is missing).
- [ ] **Step 4: Run** the two specs and the whole web suite (`pnpm --filter web test`): PASS (existing tests rely on the inline fallback).
- [ ] **Step 5: Commit** `perf(web): emails and pushes go out after the answer; Resend timeout`.

### Task 3: Notice outbox, split cron, retention (items 7 and 24)

**Files:** Create `packages/domain/src/bookings/outbox.ts`, `packages/domain/src/retention.ts`, `apps/web/lib/cron.ts`, `apps/web/app/api/cron/money/route.ts`, `apps/web/app/api/cron/invoices/route.ts`; modify `bookings/timers.ts`, `bookings/notify.ts`, `payments/watches.ts:30`, `reviews.ts:62`, `invoices/issue.ts:192`, `apps/web/app/api/cron/{bookings,suspensions}/route.ts`, `apps/web/vercel.json`; tests `apps/web/tests/cron-bookings.int.spec.ts`, `timers.int.spec.ts`, `cron-suspensions.int.spec.ts`.

**Interfaces:**
- `notifyBookingEvent(kind, userId, params, opts: { written?: boolean } = {})`: `written: true` = the in-app row exists, send email and push only. The `WRITTEN_BY_TIMERS` list is deleted; its other callers (`watches.ts`, `reviews.ts`, `invoices/issue.ts`) pass `{ written: true }`.
- Every notification `INSERT` in `timers.ts` sets `mailed_at` to NULL and returns `id`; `result()` returns the inserted ids instead of the events; `sendEmails` and `TimerEvent` are deleted.
- Produces: `drainOutbox(exec: typeof db, now: Date, opts?: { ids?: string[]; timeUp?: () => boolean }): Promise<number>`: claims one row at a time (`UPDATE notifications SET mailed_at = now WHERE id = (SELECT id ... WHERE mailed_at IS NULL AND created_at > now - OUTBOX_MAX_AGE_HOURS ... ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING user_id, kind, payload`), then `notifyBookingEvent(kind, user_id, payload, { written: true })`; stops on `timeUp()`. `OUTBOX_MAX_AGE_HOURS = 48` (an older unsent notice is not emailed late). Claim before send: a cut-off loses at most the one email in flight.
- Produces (timers.ts): `runExpiryAndReminders(exec, now, opts?: ReleaseOptions): Promise<TimerReport>` (the SQL rules and ending rules, then the drain), `runMoneySteps(exec, now, opts?)` (no-shows, releases with deferred invoices, then the drain), `runDocuments(exec, now, opts?)` (due invoices, commission invoices, then the drain). Each measures its own budget (`RELEASE_BUDGET_MS`). `runDueTimers` stays as the three in order (the existing tests use it). `runDueTimersFor` sweeps, then `drainOutbox(db, now, { ids })`.
- Produces: `cronAuthorized(request: Request): boolean` in `apps/web/lib/cron.ts`: the one `CRON_SECRET` check (`timingSafeEqual`; false without a secret); each of the four cron routes starts with `if (!cronAuthorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 })` (this also removes item 30's copied secret check; Stage D relies on this name). Each route keeps `export const maxDuration = 60`.
- `vercel.json` crons (daily, distinct hours so the free plan's within-the-hour timing keeps the order): `/api/cron/bookings` `0 3 * * *`, `/api/cron/money` `0 4 * * *`, `/api/cron/invoices` `0 5 * * *`, `/api/cron/suspensions` `0 6 * * *`. Owner check before merge: the plan's cron-job count limit allows four.
- Produces: `pruneOldRows(exec: typeof db, now: Date): Promise<{ notifications: number; stripeEvents: number; pushTokens: number }>` in `retention.ts`, run by the suspensions route: notifications seen or dismissed more than `NOTIFICATION_KEEP_DAYS = 180` ago, except kind `requests-ignored` (the timers read its latest date); `stripe_events` older than `STRIPE_EVENT_KEEP_DAYS = 90` (Stripe stops retrying after 3 days); `push_tokens` not seen for `PUSH_TOKEN_KEEP_DAYS = 270`. Periods are proposals for the owner (README). The rules' WHERE clauses keep their current predicates so Stage A's partial indexes apply.

- [ ] **Step 1: Write the failing tests**: `outbox: a run that stops halfway leaves the rest for the next run` (three due reminders, `timeUp` true after the first send: one email, two rows still unmailed; a second drain sends the two); `a notice older than 48 hours is not emailed`; `each cron route has its own budget: a slow release does not stop the invoices route` (fake clock); `every cron route answers 401 without the secret` (loop over the four routes); `pruneOldRows keeps unseen notices and requests-ignored, removes old seen ones, old stripe events and stale push tokens`.
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run tests/cron-bookings.int.spec.ts tests/timers.int.spec.ts tests/cron-suspensions.int.spec.ts`: FAIL.
- [ ] **Step 3: Implement** as in Interfaces.
- [ ] **Step 4: Run** the three specs, `booking-notifications.int.spec.ts`, `push-send.int.spec.ts`, `reviews.int.spec.ts`, `invoices.int.spec.ts`: PASS.
- [ ] **Step 5: Commit** `feat(cron): notice outbox, cron split into four routes, retention clean-up`.

### Task 4: Customer withdraws a request, provider declines one (item 25)

**Files:** Modify `packages/domain/src/bookings/requests.ts`, `timers.ts` (ignoredNoticeFlags), `packages/db/src/rls.ts`; create `apps/web/app/app-api/v1/requests/[id]/withdraw/route.ts`, `.../decline/route.ts`; test `apps/web/tests/requests-quotes.int.spec.ts`, `rls-bookings.int.spec.ts`.

**Interfaces:**
- Produces: `withdrawRequest(tx: Tx, userId: string, requestId: string, now = new Date(), afterCommit: AfterCommit = () => {}): Promise<BookingRequest>`: the request's customer only (provider 403 `not-your-turn`, anyone else 404); `lockRequest`, read again; status `open|quoted` (else 409 `request-closed`); sets `withdrawn`; tells the provider owner `request-withdrawn`. Runs on the request `tx` (no owner connection).
- Produces: `declineRequest(tx, userId, requestId, now = new Date(), afterCommit = () => {}): Promise<BookingRequest>`: the provider's owner only (customer 403); same checks; sets `declined`; tells the customer `request-declined`. A decline counts as an answer in `ignoredNoticeFlags` (`OR EXISTS (SELECT 1 FROM requests r WHERE r.provider_id = p.id AND r.status = 'declined' AND r.updated_at > n.at)`).
- Produces (rls.ts): trigger function `close_request_quotes()` SECURITY DEFINER, `AFTER UPDATE OF status ON requests FOR EACH ROW WHEN (NEW.status IN ('withdrawn','declined') AND OLD.status IS DISTINCT FROM NEW.status)`: `UPDATE quotes SET status = 'declined' WHERE request_id = NEW.id AND status = 'sent'` (no reminder or accept on a closed request).
- Routes: `POST /app-api/v1/requests/{id}/withdraw` and `POST /app-api/v1/requests/{id}/decline`, no body, answer the `BookingRequest`.

- [ ] **Step 1: Write the failing tests**: `the customer withdraws an open and a quoted request; the provider is told`; `the provider declines; the customer is told; the request leaves the pair limit`; `the other side gets 403, a stranger 404, a booked request 409`; `withdraw racing sendQuote leaves no sent quote` (both in parallel: either 409 `request-closed` on the quote, or the new quote ends `declined`); `a declined request stops the requests-ignored flag`; in `rls-bookings.int.spec.ts`: `app_user may move a request to withdrawn (customer) and declined (provider), not the other way round` and `app_user cannot set a request from booked to quoted by hand` (pin the `APP_STATUS_MOVES` entries).
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run tests/requests-quotes.int.spec.ts tests/rls-bookings.int.spec.ts`: FAIL.
- [ ] **Step 3: Implement**; the four `APP_STATUS_MOVES.requests` entries from Global Constraints; export the two functions from `packages/domain/src/index.ts`.
- [ ] **Step 4: Run** the two specs and `timers.int.spec.ts`: PASS.
- [ ] **Step 5: Commit** `feat(bookings): customers withdraw and providers decline a request`.

### Task 5: A quote-born booking that ends unagreed reopens its request (item 2)

**Files:** Modify `packages/db/src/rls.ts`, `packages/domain/src/bookings/{bookings,timers,notify}.ts`; test `apps/web/tests/bookings.int.spec.ts`, `timers.int.spec.ts`.

**Interfaces:**
- Produces (rls.ts): trigger function `reopen_quote_request()` SECURITY DEFINER, `AFTER UPDATE OF status ON bookings FOR EACH ROW WHEN (OLD.status IN ('proposed','awaiting-payment') AND NEW.status IN ('declined','expired','withdrawn') AND NEW.quote_id IS NOT NULL AND NEW.parent_booking_id IS NULL)`: the quote `accepted -> sent` when `expires_at > NEW.updated_at`, else `-> expired`; its request `booked -> quoted` with `updated_at = NEW.updated_at`. `NEW.updated_at` is the time every path writes (the injected `now`), so tests with a fixed clock agree. An expired quote leaves the request `quoted` (today's rule for an expired quote, `timers.ts:87`), never `expired`: an expired request would count toward the provider's requests-ignored notice. Additional tasks (parent set) are not reopened: the customer starts a new one.
- Notices: the customer's `booking-expired` (timers, both expiry rules) becomes `request-reopened` with payload `{ requestId, bookingId }` when the quote reopened (`CASE` in the CTE's insert, the same predicate as the trigger: `q.expires_at > t` joined through `e.quote_id`, root only; a comment in both places points at the other). The provider keeps `booking-expired`. In `answerBooking`, the provider's decline tells `request-reopened` instead of `booking-declined` when the quote reads `sent` after the update. `dateOf` in `notify.ts` gives `request-reopened` the quote's `expires_at` through `bookings.quote_id`. A withdraw tells nobody (the customer acted).

- [ ] **Step 1: Write the failing tests**: `provider declines a quote-born proposal: request quoted, quote sent, the customer can accept again and gets request-reopened`; `the customer withdraws an awaiting-payment booking: the provider can send a revised quote`; `a lapsed proposal and an unpaid expiry reopen the request (timer) and send request-reopened through the outbox`; `reopen at the quote's expiry keeps the quote expired` (quote `expires_at` equal to `now`: request `quoted`, quote `expired`, acceptQuote 409 `quote-expired`); `a direct booking and an additional task change no request`.
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run tests/bookings.int.spec.ts tests/timers.int.spec.ts`: FAIL.
- [ ] **Step 3: Implement** as in Interfaces.
- [ ] **Step 4: Run** the two specs, `requests-quotes.int.spec.ts`, `booking-notifications.int.spec.ts`, `account-delete.int.spec.ts`: PASS.
- [ ] **Step 5: Commit** `fix(bookings): an unagreed quote-born booking reopens its request and quote`.

### Task 6: Either side opens a dispute after Finished or Stop (item 25)

**Files:** Modify `packages/domain/src/bookings/disputes.ts`, `apps/web/app/app-api/v1/bookings/[id]/dispute/route.ts` (doc comment); test `apps/web/tests/disputes.int.spec.ts`.

**Interfaces:**
- `openDispute(tx, userId, bookingId, input, now = new Date())` keeps its signature. Allowed: either side from `finished` while `confirmBy > now` (after: 409 `DISPUTE_CLOSED`); either side from `stopped` while `confirmBy` is null (no agreed amount yet); the customer from `confirmed` once asked (unchanged). `openedBy` is the caller's side, reason `problem`. On a `disputed` booking: the caller's own undecided `problem` dispute is returned (a second tap), any other dispute is 409 `DISPUTE_EXISTS`. Both sides are told (`tellDisputeOpened`, unchanged). Keeps the existing owner-connection pattern of this file (Stage A decides whether that pattern changes).

- [ ] **Step 1: Write the failing tests**: `the provider disputes a finished booking: disputed, the release stops, both told`; `either side disputes a stopped booking before an amount is agreed; after agreement 409 not-open`; `the second opener gets 409 DISPUTE_EXISTS, the first its own dispute again`; existing `dispute and auto-release race: exactly one outcome` still passes with the provider as opener.
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run tests/disputes.int.spec.ts`: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `disputes.int.spec.ts`, `finish.int.spec.ts`, `timers.int.spec.ts` (stopsToStaff): PASS.
- [ ] **Step 5: Commit** `feat(disputes): either side may open a dispute after Finished or Stop`.

### Task 7: Read-one routes and cursor pagination (item 21)

**Files:** Modify `packages/contract/src/{bookings,chat,common}.ts`, `packages/domain/src/bookings/{bookings,requests}.ts`, `chat/threads.ts`, list routes; create `apps/web/app/app-api/v1/bookings/[id]/route.ts`, `apps/web/app/app-api/v1/threads/[id]/route.ts`; mobile `src/api/{bookings,chat}.ts`, `screens/bookings/{booking-detail,request-detail,my-bookings}.tsx`, `screens/chat/{thread,thread-list}.tsx`, i18n `list.showMore`; tests `apps/web/tests/bookings.int.spec.ts`, `chat.int.spec.ts`, `requests-quotes.int.spec.ts`.

**Interfaces:**
- Contract: `CursorSchema = z.string().regex(/^[^|]+\|[0-9a-f-]{36}$/)` (`<ISO time>|<uuid>`, as `MessagesQuerySchema.after`); `ListQuerySchema = z.object({ role: z.enum(['customer','provider']).default('customer'), cursor: CursorSchema.optional() })`; `type Page<T> = { docs: T[]; next: string | null }`; `BookingViewSchema = z.object({ booking: BookingSchema, viewer: z.enum(['customer','provider']), threadId: z.string().nullable() })`, `type BookingView` (the shape Stage D's plan consumes); `BookingRequestSchema` gains `threadId: z.string().nullish()` (set by `getRequest` only). `LIST_PAGE = 50`.
- Produces: `getBooking(tx: Tx, userId: string, id: string): Promise<BookingView>`: 404 for a non-party; the address rule of `view()`; no writes (no timers, no thread creation).
- Produces: `threadIdOf(exec: Exec, b: { id: string; requestId: string | null; parentBookingId: string | null }): Promise<string | null>` in `chat/threads.ts`, read-only (the booking's own thread, else its request's, else the parent's).
- Produces: `listBookings(tx, userId, role, cursor?: string): Promise<Page<Booking>>` pages over root bookings (`parent_booking_id IS NULL`, newest first by `(created_at, id)`), each followed by its additional tasks (oldest first); `listRequests(tx, userId, role, cursor?): Promise<Page<BookingRequest>>`; `listThreads(tx, userId, cursor?): Promise<Page<Thread>>` (cursor on the last activity time); `getThread(tx, userId, id): Promise<Thread>` (404 for a non-party). The `runDueTimersFor` call in the two list functions stays as is (Stage C, item 28, decides it; keep the paging change apart from it).
- Routes: `GET /app-api/v1/bookings/{id}` -> `BookingView` `{ booking, viewer, threadId }`; `GET /app-api/v1/threads/{id}` -> `Thread`; `GET /app-api/v1/{bookings,requests}?role=&cursor=` and `GET /app-api/v1/threads?cursor=` -> `{ docs, next }`; a bad cursor or role is 400 (`parseQuery`).
- Mobile: `getBooking(id): Promise<BookingView>`, `getThread(id): Promise<Thread>`; `listBookings(role, cursor?)`, `listRequests(role, cursor?)`, `listThreads(cursor?)` return `Page`; `booking-detail.tsx` `find()` becomes `getBooking` (its `Found` type is `{ booking, viewer }`, so the screen keeps working); `threadIdForBooking` is replaced by the view's `threadId`; `thread.tsx` loads `getThread(id)` and `listBlocks()`; `request-detail.tsx` passes `request.threadId` to `OpenChat`; `my-bookings.tsx` and `thread-list.tsx` show a "Show more" button (`list.showMore`, DE "Mehr anzeigen", EN "Show more") while `next` is set. Stage D builds its Open buttons and the pay card on `getBooking`.

- [ ] **Step 1: Write the failing tests**: `GET /bookings/{id} answers each party with viewer and threadId, a stranger 404, and writes nothing`; `GET /threads/{id} answers a party, a stranger 404`; `cursor pages over equal createdAt without loss` (three bookings with one `created_at`, page size forced to 2 through an exported `LIST_PAGE` override or 51 rows: every id exactly once); `an additional task follows its root on the root's page`; `a bad cursor is 400`; `GET /requests/{id} carries the thread id`.
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run tests/bookings.int.spec.ts tests/chat.int.spec.ts tests/requests-quotes.int.spec.ts`: FAIL.
- [ ] **Step 3: Implement** server, then mobile.
- [ ] **Step 4: Run** the three specs, `pnpm --filter mobile test`, `npx tsc --noEmit` in `apps/mobile`, `apps/web`, `packages/domain`, `packages/contract`: PASS.
- [ ] **Step 5: Commit** `perf(api): read-one booking and thread routes, cursor pages for lists`.

### Task 8: Mobile buttons for withdraw, decline and the wider dispute (item 25)

**Files:** Modify `apps/mobile/src/api/bookings.ts`, `src/screens/bookings/request-detail.tsx`, `src/lib/booking-status.ts`, i18n keys `request.withdraw`, `request.withdrawConfirm`, `request.decline`, `request.declineConfirm`; test `apps/mobile/src/lib/booking-status.test.ts`.

**Interfaces:**
- Consumes: Task 4 routes; Task 6 rules.
- Produces: `withdrawRequest(id: string): Promise<BookingRequest>`, `declineRequest(id: string): Promise<BookingRequest>` in `src/api/bookings.ts`.
- `request-detail.tsx`: while the request is `open|quoted`, the customer sees "Withdraw request" and the provider "Decline request", each behind `confirmDanger` (as the booking decline and withdraw), busy-disabled through `useSubmit`, then `retry()`.
- `bookingActions`: the provider gets `dispute` on `finished` while `confirmBy` is in the future; both sides get `dispute` on `stopped` while `confirmBy` is null (alongside `stateStopAmount` / `answerStop`).
- Texts: "Withdraw request" / "Anfrage zurückziehen", confirm "Withdraw this request? The provider is told." ; "Decline request" / "Anfrage ablehnen", confirm "Decline this request? The customer is told."

- [ ] **Step 1: Write the failing tests** in `booking-status.test.ts`: `the provider may dispute a finished booking before confirmBy, not after`; `either side may dispute a stopped booking until an amount is agreed`.
- [ ] **Step 2: Run** `pnpm --filter mobile test -- booking-status`: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm --filter mobile test`, `npx tsc --noEmit` and `npx expo lint` in `apps/mobile`, `pnpm --filter @kando/i18n test`: PASS.
- [ ] **Step 5: Commit** `feat(mobile): withdraw or decline a request; disputes for both sides`.

### Task 9: Search pages in SQL with a cached offerable flag and ratings (item 22)

**Files:** Modify `packages/db/src/rls.ts`, `packages/domain/src/search.ts`, `public-profile.ts`, `packages/contract/src/providers.ts`, mobile `src/screens/search/provider-card.tsx`, `src/screens/provider/provider-screen.tsx`, i18n `search.rating`; create `apps/web/tests/offerable-flag.int.spec.ts`; test `apps/web/tests/search.int.spec.ts`.

**Interfaces:**
- Consumes: Task 1 `services.offerable`; Stage A's GiST index on `(providers.location::geography)` (the `ST_DWithin(p.location::geography, ...)` prefilter must keep exactly that expression).
- Produces (rls.ts): `service_offerable(p_service uuid) RETURNS boolean` SECURITY DEFINER (priced, and every required document of its category approved for the provider's owner). Triggers keep `services.offerable` true to it: `BEFORE INSERT OR UPDATE OF category_id, price_type, price ON services` sets `NEW.offerable`; `AFTER INSERT OR UPDATE OF status, requirement OR DELETE ON documents` recomputes the services of that owner's providers; `AFTER UPDATE OF required_documents ON categories` recomputes that category's services. `offerable_service_ids` reads `s.offerable` and keeps its publish, suspension and owner condition. `services.offerable` goes into `COLUMN_STAFF_ONLY.services` (only the triggers write it).
- `search()`: the visibility, category and in-radius rules and the order run in SQL; the in-radius distance uses the same haversine as `distanceKm` (R = 6371 km) written as one SQL expression with a comment pointing at `packages/db/src/postcodes.ts`; `ORDER BY` distance in radius `NULLS LAST`, `lower(public_name)`, `id`; `LIMIT PAGE_SIZE + 1 OFFSET (page - 1) * PAGE_SIZE`; `hasMore` from the extra row. `MAX_CANDIDATES` and the JS ranking are deleted. Names now sort by `lower()` instead of `localeCompare(lang)` (say so in the report).
- Contract: `SearchItemSchema` gains `rating: RatingSchema.nullable()`; `isNew` is `rating === null` in `search()` and `getPublicProfile`. Mobile cards and the provider screen show `search.rating` ("{average} ★ ({count})", both languages) when rated, else the New badge.

- [ ] **Step 1: Write the failing tests**: in `offerable-flag.int.spec.ts`: `approving the last required document makes the service offerable`, `a new required document removes the services from search at once`, `deleting an approved document or clearing the price clears the flag`, `app_user cannot write offerable`; in `search.int.spec.ts`: `providers beyond the old 500 are found on later pages` (501 offerable providers inserted in one `generate_series` statement), `a rated provider shows its rating and is not new`; the existing radius-edge, paging and remote tests stay green.
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run tests/offerable-flag.int.spec.ts tests/search.int.spec.ts`: FAIL.
- [ ] **Step 3: Implement**, then `pnpm db:migrate` (re-applies rls.ts).
- [ ] **Step 4: Run** the two specs, `provider-public.int.spec.ts`, `publish-flow.int.spec.ts`, `rls-providers.int.spec.ts`, `sitemaps.int.spec.ts`, `pnpm --filter mobile test`: PASS.
- [ ] **Step 5: Commit** `perf(search): SQL paging, cached offerable flag, ratings on cards`.

### Task 10: Currency and search country from the country (item 32)

**Files:** Modify `packages/domain/src/bookings/requests.ts`, `search.ts`, `packages/contract/src/providers.ts`, `apps/web/app/(site)/providers-sitemap.xml/route.ts`; test `apps/web/tests/requests-quotes.int.spec.ts`, `search.int.spec.ts`, `sitemaps.int.spec.ts`.

**Interfaces:**
- Consumes: Task 1 `countries.currency`.
- `sendQuote` stores the currency of the provider's country (`SELECT currency FROM countries WHERE code = provider.country`) and the chat card uses `row.currency`. `CurrencySchema` stays `'EUR'` until a second currency is sold (the second market changes it).
- `SearchQuerySchema.country` becomes `z.string().optional()`; `search()` takes `country?: string` and, when absent, `marketCountry(tx): Promise<string>` = the only `countries` row, else 400 `country-required` (the app must then send it; South Africa later). The card currency fallback is the country's currency. `visibleProviderSlugs(tx)` drops its country parameter: the sitemap lists every market.

- [ ] **Step 1: Write the failing tests**: `a quote takes the currency of the provider's country` (a test country `ZZ` with currency `ZAR` inserted and removed by the test: the quote row says `ZAR`); `search without a country uses the only market; with two markets it is 400 country-required`; `the providers sitemap lists providers of every country`.
- [ ] **Step 2: Run** the three specs: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the three specs: PASS.
- [ ] **Step 5: Commit** `fix(country): quote currency and search country come from the country`.

### Task 11: Cached public website (item 23)

**Files:** Move `apps/web/app/(site)/{layout,page,not-found}.tsx`, `[slug]/`, `providers/`, `payment-done/`, `payout-done/` under `apps/web/app/(site)/[lang]/`; create `apps/web/app/(site)/[lang]/providers/[slug]/translated/page.tsx`, `apps/web/lib/public-cache.ts`; modify `apps/web/proxy.ts`, the routes listed below; test `apps/web/tests/proxy.int.spec.ts`, `provider-page.int.spec.ts`, `home-page.int.spec.ts`.

**Interfaces:**
- Read the Next 16.4 guides in `node_modules/next/dist/docs` on dynamic segments, `generateStaticParams`, ISR (`revalidate`) and `revalidatePath` before moving files.
- `proxy.ts` rewrites (not redirects) every site path to `/{lang}{path}` with `lang = siteLang(?lang=)`, so the public URLs (`/providers/x?lang=en`) stay the same and `langPath`/`alternates` are unchanged; `?translate=1` on a provider page rewrites to `/{lang}/providers/{slug}/translated` (stays dynamic, `noindex`). The matcher also skips `robots.txt` and `*.xml` (the sitemaps). A direct `/de/...` or `/en/...` request redirects to its `?lang=` form. The `x-lang` header is removed.
- The layout and pages take `lang` from `params` (validated with `siteLang`, unknown -> `notFound()`); none reads `headers()`, `cookies()` or `searchParams`. `generateStaticParams` returns `[]` (rendered on first request, no database at build). `export const revalidate = 300` on provider pages, `3600` on the home and `[slug]` pages.
- Produces: `refreshPublicPages(kind: 'providers' | 'home' | 'pages'): void` in `public-cache.ts`: `revalidatePath('/[lang]/providers/[slug]', 'page')` (resp. `'/[lang]'`, `'/[lang]/[slug]'`); outside a Next request scope (vitest) it does nothing. Called after the change in: `provider-profile` (PUT/PATCH), `provider-profile/publish`, `provider-profile/unpublish`, `services`, `services/[id]`, `references`, `references/[id]`, `photos`, `photos/[id]`, `me` (PATCH, DELETE), `payouts/status`, admin `documents/[id]/review`, `users/[id]/suspend`, admin `[resource]` (providers, photos: `providers`; categories: `home`; pages: `pages`), the suspensions cron.

- [ ] **Step 1: Write the failing tests**: in `proxy.int.spec.ts`: `a site path is rewritten to its language segment; ?lang=en to /en`, `?translate=1 goes to the translated page`, `sitemaps and robots.txt are not rewritten`, `a direct /en/ path redirects to ?lang=en`; in `provider-page.int.spec.ts` and `home-page.int.spec.ts`: render with `params: { lang }` instead of `searchParams`.
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run tests/proxy.int.spec.ts tests/provider-page.int.spec.ts tests/home-page.int.spec.ts`: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the three specs, `pages.int.spec.ts`, `sitemaps.int.spec.ts`, `security-headers.int.spec.ts`; then `pnpm --filter web build`: the route table shows `/[lang]`, `/[lang]/[slug]` and `/[lang]/providers/[slug]` as ISR (revalidate shown), not Dynamic. PASS.
- [ ] **Step 5: Commit** `perf(site): language from the path, cached pages refreshed on change`.

### Task 12: Whole-stage check, report, README

**Files:** Create `Reports/Assessment-Stage-B-Test-Report.xlsx` (layout of `Reports/Stage-2e-Test-Report.xlsx`); modify `README.md`.

- [ ] **Step 1: Run** `pnpm test` (web, domain, contract, i18n with vitest; mobile with jest), `npx tsc --noEmit` in `apps/web`, `apps/mobile`, `packages/db`, `packages/domain`, `packages/contract`, `packages/i18n`, and `pnpm lint`. Expected: all pass; paste each output into the report (sheet per package, counts on the summary sheet).
- [ ] **Step 2: Report** Open Items: phone checks (withdraw, decline, provider dispute, reopened quote, Show more, rating on cards); the owner decisions (retention periods 180/90/270 days; four cron entries on the free plan; name sort by `lower()`); ponytail: no index for `notifications.mailed_at IS NULL` or `services.offerable` (Stage A's no-new-index rule; add partial indexes in a later migration once those tables grow); the German texts for the native read; migration 0023 to `kando-dev` and `kando-main` before the release merge.
- [ ] **Step 3: README**: an "Assessment fixes" table row for Stage B (status, branch, report), the new cron schedule in "In the background", request withdraw/decline and either-side disputes in "What the app does today".
- [ ] **Step 4: Commit** `docs: assessment stage B report and README`.
