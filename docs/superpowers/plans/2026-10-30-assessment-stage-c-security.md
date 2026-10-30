# Assessment Stage C: security fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the security findings 4, 9 (chat-send limit in code), 10, 11, 12, 14, 28 and 29 of the 30 October assessment: deleting an account needs the password, chat sending has a limit, public texts refuse contact details, Reviewers no longer see payment and tax fields, uploads are capped without buffering, a script-src policy is trialled and then enforced, writes without an Origin are refused, list reads stop writing, private answers are not cached, blocked contact text is deleted after a while, and the small cron and config gaps are closed.

**Architecture:** Every fix goes where all callers already route through: the app and back-office wrappers (`packages/domain/src/app-request.ts`, `apps/web/lib/admin-request.ts`), the origin rule (`origin.ts`), the contact check (`chat/flags.ts`), the booking DTO mappers (`bookings/requests.ts`), `next.config.ts`. The password is checked against Neon Auth in-process (the same handler the app signs in through), and the temporary session that check creates is signed out at once. Expiry stays a daily cron write; a list read only *shows* a lapsed row as expired. No new table, no migration, no new dependency.

**Tech Stack:** existing stack (Next.js 16.4 route handlers, Drizzle, Neon Auth `@neondatabase/auth`, sharp, Expo app with jest). Nothing installed.

**Spec:** `docs/superpowers/specs/2026-10-30-assessment-findings.md` (the assessment table; items 4, 9, 10, 11, 12, 14, 28, 29). Builds on the Stage A plan `2026-10-30-assessment-stage-a-database-connections.md` (two pools `pool`/`db` owner and `appPool`/`appDb` request; `AfterTransaction` handler answers; `Opts.prepare(request, onFailure)`; uploads stored in `prepare`) and the Stage B plan (cursor pagination of the lists, single booking and thread reads, the clean-up cron split of item 24). Read `apps/web/AGENTS.md` and `apps/mobile/AGENTS.md` first. **Re-grep every file named here before editing: Stages A and B change several of them.**

## Findings covered (verified in code on `release/assessment-fixes` at 7617df9)

- **4 Confirmed.** `apps/web/app/app-api/v1/me/route.ts:12-14` takes only `{ confirmEmail }`; `packages/domain/src/account.ts:100,109` compares it with the stored email. Anyone holding a signed-in phone can erase the account.
- **9 Confirmed (chat part).** `chat/messages.ts:62-68` (`sendMessage`) and `:71-79` (`sendPhoto`) count nothing; only blocked contact attempts are counted (`chat/flags.ts:18-27`). Login, uploads, signed links, search and payout set-up limits are Vercel WAF rules: owner action, not planned.
- **10 Confirmed.** Unchecked public text: `providers/profile.ts:153-160` (business name, bio, strengths, skills, experience), `providers/items.ts:67,98` (service title and description), `:144,170` (reference client name and description), `users.ts:100-110` (first and last name, which make the public name), `photos.ts:25` (photo alt text). Impressum and tax number stay exempt (legal duty to show contact details there). Chat photos stay a known limit (no OCR).
- **11 Confirmed.** `admin/resources.ts:80-90` (`getProvider`) spreads the whole `providers` row, including `stripeAccountId`, `taxNumber`, `vatId`, `legalStatus`, `invoiceConsentAt`, `payoutsReadyAt`; `roleFor` (`:31`) lets a Reviewer GET providers. The back-office page (`app/admin/providers/show/[id]/page.tsx`) uses only `publicName`, `ownerEmail`, `type`, `status`, `suspended`, `photos`.
- **12 Confirmed.** `app-request.ts:51-57` reads `request.clone().arrayBuffer()` (the whole body) before comparing with the cap, and a missing `Content-Length` counts as 0. Pixel cap 40 MP in `photos.ts:13` and `documents.ts:16`; the app already resizes photos to 1600 px (`apps/mobile/src/lib/pick.ts:6`), and a document over 4.5 MB cannot arrive, so 25 MP refuses nothing real.
- **14 Confirmed.** `apps/web/next.config.ts:9` sends `frame-ancestors 'none'; object-src 'none'; base-uri 'self'` only.
- **28 a. Origin: confirmed.** `origin.ts:8` passes any write without an `Origin`. The comment there ("the phone app sends no Origin") is stale: the app sends `Origin` = the API origin (`apps/mobile/src/api/client.ts:86-87`, Better Auth needs it). Browsers send `Origin` on every non-GET request; cron and the Stripe webhook are not wrapped. So a cookie-carrying write without `Origin` can be refused without breaking anyone.
- **28 b. GET lists change state: confirmed.** `listRequests` (`requests.ts:153`) and `listBookings` (`bookings.ts:67`) run `runDueTimersFor(db, …)`: four UPDATEs, notification rows and emails on a GET. `GET payouts/status` also writes `payouts_ready_at` (`payments/onboarding.ts:45`): kept on purpose (it reconciles with Stripe, idempotent; Stage A moves the Stripe call out of the transaction).
- **28 c. No `no-store`: confirmed.** Signed links in `files/[id]` GET, `invoices/[id]/pdf`, `commission-invoices/[id]/pdf`, chat messages (`photoUrl`), and the exports (`me/export`, `invoices/export`) are answered without `Cache-Control`.
- **28 d. Blocked contact text kept forever: confirmed.** `contact_attempts.text` (`schema/chat.ts:95`) is deleted only with the account.
- **28 e. Admin user id: confirmed.** `admin/users.ts:59` (`getUser`) and `:69` (`suspendUser`) take any string (`users.id` is text, so no SQL error; unbounded input reaches the query).
- **28 f. Internal ids: checked, accepted.** The provider sees the customer's auth user id as `customerId` (`contract/bookings.ts:31,107`; the app compares it with its own id, `request-detail.tsx:42`). It is not a credential, every route checks the party through row-level security, and the provider already sees the person's name. No change.
- **29 Confirmed.** `api/cron/suspensions/route.ts` has no `maxDuration`; no `Strict-Transport-Security` in code (Vercel's default header has no `includeSubDomains`); `.env.example` lacks `PAYMENTS_ENABLED`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`, `EXPO_ACCESS_TOKEN`, `DELETE_RETENTION_MONTHS`, `TRANSLATE_GLOBAL_LIMIT_PER_DAY`, `ALLOW_PRODUCTION`, `SEED_USERS_FILE`.

## Global Constraints

- Branch `assessment-c-security` from `release/assessment-fixes` after Stages A and B are merged; pull request into `release/assessment-fixes`; the owner merges. Order of stages: A, B, C, D.
- No migration (Stage A owns 0022, Stage B 0023; 0024 stays free). No new table, no new dependency.
- TDD: each task's failing test first. Web: `pnpm --filter web exec vitest run <file>` (Docker Postgres on 5433). Domain, contract, i18n: `pnpm --filter <pkg> test`. Mobile: jest, `pnpm --filter mobile test`.
- Every new text in German and English (`packages/i18n/src/de.ts`, `en.ts`; the parity test must pass); every new server error code mapped in `apps/mobile/src/i18n/index.ts`.
- Germany-agnostic: no country-specific rule added.
- New error codes, exactly: `WRONG_PASSWORD` (403), `AUTH_BUSY` (503), `MESSAGE_LIMIT` (429), `LENGTH_REQUIRED` (411). New text keys, exactly: `account.deletePassword`, `account.wrongPassword`, `error.authBusy`, `chat.sendLimit`. Removed: code `EMAIL_MISMATCH`, key `account.emailMismatch`, key `account.deleteType`.
- Constants, exactly: `MESSAGE_LIMIT = 30`, `MESSAGE_LIMIT_WINDOW_MINUTES = 10` (`chat/rules.ts`); `CONTACT_ATTEMPTS_KEEP_DAYS = 90` (`chat/rules.ts`); `MAX_PIXELS = 25_000_000` (one export in `photos.ts`, imported by `documents.ts`); HSTS `max-age=63072000; includeSubDomains` (no `preload`).
- Commit messages carry no AI co-author or "Generated with" line.

## Review Focus

- A wrong password must not delete anything and must not sign the phone out or hand it a new session: the answer carries no `Set-Cookie` (Task 1 test `a wrong password is 403 WRONG_PASSWORD, deletes nothing and sets no cookie`).
- The phone app's writes (Origin = API origin, with Cookie) keep working, and a browser write from the same site keeps working; only a cookie write without Origin is refused (Task 3 test `a cookie write without Origin is 403; a cookieless write and a GET without Origin pass`).
- A request or booking past its deadline reads as expired on both sides without any write, and the customer may send a new request to that provider at once (Task 4 test `a lapsed request reads expired in the list and alone, the row is untouched, and a new request to the provider is accepted`).
- A provider whose stored bio already holds a phone number (saved before this change) can still save other fields; only the fields sent are checked (Task 5 test `a save that does not send the bio passes although the stored bio holds a phone number`).
- A chat photo over the limit is refused before anything is stored (Task 6 test `the 31st message in 10 minutes is 429 MESSAGE_LIMIT, also for a photo, and no object is stored`).

---

## File structure

- `apps/web/lib/auth/server.ts`: `verifyPassword`. `apps/web/app/app-api/v1/me/route.ts` (DELETE). `packages/contract/src/me.ts` (`DeleteMeSchema`). `packages/domain/src/account.ts` (`deleteAccount` loses `confirmEmail`).
- `apps/mobile/src/screens/account-data-section.tsx`, `apps/mobile/src/api/account.ts`, `apps/mobile/src/lib/account-data.ts` (+ test), `apps/mobile/src/i18n/index.ts`, `packages/i18n/src/de.ts`, `en.ts`.
- `packages/domain/src/origin.ts`, `packages/domain/src/app-request.ts` (Origin is already called here; add `no-store`; the body-cap block), `apps/web/lib/admin-request.ts`.
- `packages/domain/src/bookings/requests.ts` (`toRequest`, `toQuote`, `toBooking`, `listRequests`), `bookings/bookings.ts` (`listBookings`), `bookings/rules.ts` (`bookingShownStatus`), `bookings/timers.ts` (`runDueTimersFor` removed), `packages/domain/src/index.ts`.
- `packages/domain/src/chat/flags.ts` (`assertNoContactDetailsIn`, `purgeContactAttempts`), `chat/rules.ts`, `chat/messages.ts`, `providers/profile.ts`, `providers/items.ts`, `users.ts`, `photos.ts`, `documents.ts`.
- `packages/domain/src/admin/resources.ts` (`getProvider`), `admin/users.ts`, `admin/common.ts` (`isUserId`).
- `apps/web/next.config.ts`, `apps/web/app/api/cron/suspensions/route.ts` (or the clean-up route Stage B created), `.env.example`.
- Tests: `apps/web/tests/helpers.ts` and the specs named per task; new `apps/web/tests/verify-password.int.spec.ts`, `apps/web/tests/contact-public.int.spec.ts`.

### Task 1: Account deletion needs the password (server)

**Files:** modify `apps/web/lib/auth/server.ts`, `apps/web/app/app-api/v1/me/route.ts`, `packages/contract/src/me.ts`, `packages/domain/src/account.ts`, `apps/web/tests/helpers.ts` (`mockAuth`); create `apps/web/tests/verify-password.int.spec.ts`; modify `apps/web/tests/account-delete.int.spec.ts`.

**Interfaces:**
- Consumes: Stage A's `AfterTransaction` (a handler may return `async () => Response`, run after the request transaction).
- Produces: `verifyPassword(request: Request, email: string, password: string, handler = getAuth().handler()): Promise<'ok' | 'wrong' | 'busy'>` in `apps/web/lib/auth/server.ts`. It POSTs `{ email, password }` to `/api/auth/sign-in/email` through `handler.POST` with the incoming request's headers minus `cookie` (so Neon Auth's per-client limits see the caller as for a normal login) and `Origin` set to the request's own origin. 200: it signs that new session out at once (POST `/api/auth/sign-out` with the answer's Set-Cookie pairs as `Cookie`) and returns `'ok'`; 401: `'wrong'`; any other status or a thrown error: `'busy'`. Nothing of its answers reaches the phone.
- `DeleteMeSchema = z.object({ password: z.string().min(1).max(128) })`.
- `deleteAccount(userId: string, afterCommit: AfterCommit): Promise<void>` (the `confirmEmail` parameter and the `EMAIL_MISMATCH` refusal are gone; the invoice pre-step at `account.ts:100` runs when no money is open).
- DELETE `/app-api/v1/me` returns an `AfterTransaction`: `verifyPassword(request, user.email, password)`; `'wrong'` → 403 `{ error: 'WRONG_PASSWORD' }`; `'busy'` → 503 `{ error: 'AUTH_BUSY' }`; `'ok'` → `deleteAccount` and the existing answer. (Stage D Task 4 generalises `AUTH_BUSY` to every session lookup; it must reuse this code and the `error.authBusy` key added in Task 2, not add them again.)
- `mockAuth()` in `helpers.ts` adds `verifyPassword: async (_r, _e, p) => (p === 'right-password' ? 'ok' : p === 'busy' ? 'busy' : 'wrong')`.

- [ ] **Step 1: Write tests.** `verify-password.int.spec.ts` with a fake handler: `200 is ok and the new session is signed out with its own cookie`, `401 is wrong and nothing is signed out`, `429, 500 and a thrown error are busy`, `the caller's cookie is never forwarded`. `account-delete.int.spec.ts`: replace `a wrong email is 400 EMAIL_MISMATCH and deletes nothing` with `a wrong password is 403 WRONG_PASSWORD, deletes nothing and sets no cookie` (users row still there; `res.headers.get('set-cookie')` is null), add `auth busy is 503 AUTH_BUSY and deletes nothing`, change `a body without confirmEmail is 400` to `a body without password is 400`; every other deletion test sends `{ password: 'right-password' }`.
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run tests/verify-password.int.spec.ts tests/account-delete.int.spec.ts`: FAIL.
- [ ] **Step 3: Implement** the interfaces above. Grep `confirmEmail` and `EMAIL_MISMATCH` across `apps/web`, `packages` and fix every caller (seed scripts, other specs).
- [ ] **Step 4: Run** the two specs, then `tests/account-retention.int.spec.ts tests/suspended-erase.int.spec.ts tests/admin-roles.int.spec.ts`; `cd packages/contract && npx tsc --noEmit`, same in `packages/domain`, `apps/web`: PASS, no errors.
- [ ] **Step 5: Commit** `fix(security): deleting an account needs the password`.

### Task 2: Account deletion needs the password (app)

**Files:** modify `apps/mobile/src/screens/account-data-section.tsx`, `apps/mobile/src/api/account.ts`, `apps/mobile/src/lib/account-data.ts`, `apps/mobile/src/lib/account-data.test.ts`, `apps/mobile/src/i18n/index.ts`, `packages/i18n/src/de.ts`, `en.ts`.

**Interfaces:**
- Consumes: Task 1's DELETE body and codes.
- `deleteAccount(password: string)` in `api/account.ts` sends `{ password }`.
- `emailMatches` is removed; the delete button is enabled when the password field is not empty (and the rest of today's conditions).
- `accountError('delete', code)` shows `errorText(code)` for `WRONG_PASSWORD`, `AUTH_BUSY`, `LAST_ADMIN`; the generic delete text otherwise.
- Field: `<Field label={t('account.deletePassword')} secureTextEntry autoComplete="current-password" …>` in place of the email field; the password is cleared after a refusal and on cancel.
- Texts (exact): `account.deletePassword` EN "To confirm, enter your password" / DE "Gib zur Bestätigung dein Passwort ein"; `account.wrongPassword` EN "The password is not correct. Nothing was deleted." / DE "Das Passwort ist nicht richtig. Es wurde nichts gelöscht."; `error.authBusy` EN "The login service is busy for a moment. Please try again in a minute." / DE "Der Anmeldedienst ist gerade ausgelastet. Bitte versuche es in einer Minute noch einmal.". Error map: `WRONG_PASSWORD: 'account.wrongPassword'`, `AUTH_BUSY: 'error.authBusy'`. Remove `account.deleteType`, `account.emailMismatch` and the `EMAIL_MISMATCH` mapping.

- [ ] **Step 1: Write tests** in `account-data.test.ts`: `a wrong password shows the wrong-password text`, `AUTH_BUSY shows the busy text`, `a 403 WRONG_PASSWORD means not deleted` (`afterDeleteFailure`); delete the `emailMatches` tests.
- [ ] **Step 2: Run** `pnpm --filter mobile test -- account-data`: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm --filter mobile test`, `pnpm --filter @kando/i18n test`, `cd apps/mobile && npx tsc --noEmit`, `npx expo lint`: PASS.
- [ ] **Step 5: Commit** `fix(app): confirm account deletion with the password`.

### Task 3: Origin rule and no caching of private answers (28 a, 28 c)

**Files:** modify `packages/domain/src/origin.ts`, `packages/domain/src/app-request.ts`, `apps/web/lib/admin-request.ts`, `apps/web/tests/helpers.ts` (`call` adds `origin: 'http://localhost'`); test `apps/web/tests/origin-check.int.spec.ts`, `apps/web/tests/app-request.int.spec.ts`.

**Interfaces:**
- `isCrossSiteWrite(request)`: a write (not GET/HEAD) **with a `Cookie` header and no `Origin`** is now cross-site; a write without a cookie and without Origin still passes (nothing ambient to abuse); the rest unchanged. Fix the stale comment (the app sends its API origin).
- Both wrappers set `Cache-Control: private, no-store` on their answer unless the handler set a `Cache-Control` itself (one line where the answer is returned; leave the rest of the wrapper as Stages A and B left it).

- [ ] **Step 1: Write tests.** `origin-check.int.spec.ts`: change the first test to `no Origin without a cookie and the same Origin pass, a foreign Origin on a write is 403, a read with a foreign Origin passes`; add `a cookie write without Origin is 403; a cookieless write and a GET without Origin pass` for both wrappers. `app-request.int.spec.ts`: `an answer is private, no-store unless the handler set Cache-Control`.
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run tests/origin-check.int.spec.ts tests/app-request.int.spec.ts`: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the whole web suite `pnpm --filter web test`; every spec that builds its own cookie `Request` for a write and now gets 403 gets an `origin: 'http://localhost'` header (`grep -rln "new Request(" apps/web/tests`). PASS.
- [ ] **Step 5: Commit** `fix(security): refuse cookie writes without Origin, never cache private answers`.

### Task 4: List reads show lapsed rows as expired instead of writing (28 b)

Choice: the read computes the shown status; the stored row changes only in the daily cron (and in the write paths, which already check every deadline themselves: `sendQuote` `requests.ts:197`, `acceptQuote` `:236`, `answerBooking` `bookings.ts:91`, `checkout.ts:50`, and the request limit `liveRequest` `requests.ts:98`). A POST "refresh" route was rejected: one more request per list open (item 6 counts round trips) and an app change. Cost: the expiry notices and emails come with the cron run (daily on the free plan, hourly on Vercel Pro), not when someone opens a list.

**Files:** modify `packages/domain/src/bookings/rules.ts`, `rules.test.ts`, `requests.ts`, `bookings.ts`, `timers.ts`, `packages/domain/src/index.ts`; tests `apps/web/tests/timers.int.spec.ts`, `apps/web/tests/finish.int.spec.ts`.

**Interfaces:**
- `bookingShownStatus(b: { status: string; answerBy: Date | null; payBy: Date | null }, now: Date): string` in `rules.ts`: `'expired'` for `proposed` with `answerBy <= now`, and for `awaiting-payment` with `payBy + PAY_GRACE_MINUTES <= now`; the stored status otherwise.
- `toRequest(r, now = new Date())`: `open` with `answerBy <= now` shows `expired`. `toQuote(q, now = new Date())`: `sent` with `expiresAt <= now` shows `expired`. `toBooking(b, now = new Date())` uses `bookingShownStatus`. Every read (lists, `getRequest`, Stage B's single booking read) goes through these mappers.
- `listRequests` and `listBookings` no longer call the sweep; `runDueTimersFor` is deleted with its export, and `sweep` loses its `userId` and `expiryOnly` parameters (re-grep: Stage B's reopen rule lives in the sweep and stays).

- [ ] **Step 1: Write tests.** `rules.test.ts`: `bookingShownStatus: proposed past answerBy, awaiting-payment past payBy plus grace, inside the grace, other statuses unchanged`. `timers.int.spec.ts`: rewrite `listRequests and listBookings show a just-due row as expired…` as `a lapsed request reads expired in the list and alone, the row is untouched, and a new request to the provider is accepted` (stored status still `open`, no notification row), and replace `the lazy path sends no reminders…` with `a list read writes nothing` (row counts of requests, bookings, notifications unchanged). Delete `finish.int.spec.ts` `the lazy per-user path never runs the release…` (the path is gone).
- [ ] **Step 2: Run** `pnpm --filter @kando/domain test -- rules` and `pnpm --filter web exec vitest run tests/timers.int.spec.ts`: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `tests/timers.int.spec.ts tests/bookings.int.spec.ts tests/requests-quotes.int.spec.ts tests/busy-times.int.spec.ts tests/finish.int.spec.ts tests/cron-bookings.int.spec.ts`; `npx tsc --noEmit` in `packages/domain` and `apps/web`: PASS.
- [ ] **Step 5: Commit** `fix(domain): list reads show lapsed rows as expired and write nothing`.

### Task 5: Contact details refused in public texts (item 10)

**Files:** modify `packages/domain/src/chat/flags.ts`, `providers/profile.ts`, `providers/items.ts`, `users.ts`, `photos.ts`; create `apps/web/tests/contact-public.int.spec.ts`.

**Interfaces:**
- `assertNoContactDetailsIn(userId: string, texts: (string | null | undefined)[]): Promise<void>` in `flags.ts`: joins the non-empty texts with `\n` (the digit rule never crosses a line break) and calls `assertNoContactDetails` once, so one save is one recorded attempt; 422 `CONTACT_DETAILS` as in the chat (the app already maps it).
- Called before anything is written, with **only the fields the input carries**: `upsertMyProfile` (`businessName`, `bio`, `strengths`, `experience`, each of `skills`; never `impressum`, `taxNumber`), `addService`/`updateService` (`title`, `description`), `addReference`/`updateReference` (`clientName`, `description`), `updateMe` (`firstName`, `lastName`), `addPhoto` (`alt`).
- Chat photos: known limit, written in the report's Open Items.

- [ ] **Step 1: Write tests** in `contact-public.int.spec.ts` (through the routes with `call`): `a phone number in the bio, a service description, a reference and a last name is 422 CONTACT_DETAILS and nothing is saved`, `an email in the business name and a link in a skill are refused`, `an impressum with a phone number and an email is saved`, `a save that does not send the bio passes although the stored bio holds a phone number` (seed the bio through `pool`), `one refused save records one attempt`.
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run tests/contact-public.int.spec.ts`: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the spec, `tests/provider-profile.int.spec.ts tests/services-references.int.spec.ts tests/publish-flow.int.spec.ts tests/chat-safety.int.spec.ts tests/app-endpoints-wrapped.int.spec.ts`; `npx tsc --noEmit` in `packages/domain`: PASS.
- [ ] **Step 5: Commit** `fix(security): no contact details in profile, service, reference, name and photo texts`.

### Task 6: Chat-send limit (item 9, code part)

**Files:** modify `packages/domain/src/chat/rules.ts`, `chat/messages.ts`, `apps/mobile/src/i18n/index.ts`, `packages/i18n/src/de.ts`, `en.ts`; test `apps/web/tests/chat-safety.int.spec.ts`.

**Interfaces:**
- `MESSAGE_LIMIT = 30`, `MESSAGE_LIMIT_WINDOW_MINUTES = 10` in `chat/rules.ts`.
- `assertSendRate(tx: Tx, userId: string): Promise<void>` in `messages.ts`, called from `writableThread` (so before `sendPhoto` stores anything): takes `pg_advisory_xact_lock(hashtext('message_limit'), hashtext(userId))` (parallel sends take turns, as `assertWithinLimits` does), counts the caller's `text` and `photo` messages (cards excluded) in the window across all threads on `tx`, and fails 429 `{ error: 'MESSAGE_LIMIT' }` at `MESSAGE_LIMIT`. Served by Stage A's `messages_sender_id_idx`.
- Text `chat.sendLimit` EN "You are sending messages very quickly. Please wait a few minutes, then try again." / DE "Du sendest sehr schnell Nachrichten. Bitte warte ein paar Minuten und versuche es dann noch einmal."; map `MESSAGE_LIMIT: 'chat.sendLimit'`.
- Owner note (not planned): WAF rate-limit rules for `/api/auth/*`, `/app-api/v1/photos`, `/files`, `/threads/*/photos`, `/files/*` (signed links), `/providers` (search), `/payouts/setup`, and a WAF body-size rule.

- [ ] **Step 1: Write tests:** `the 31st message in 10 minutes is 429 MESSAGE_LIMIT, also for a photo, and no object is stored` (insert 30 messages through `pool` with `created_at` now; `memoryStorage().objects.size` unchanged), `messages older than 10 minutes and cards do not count`; mobile `MESSAGE_LIMIT has its own text` (`apps/mobile/src/i18n` test next to the error map).
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run tests/chat-safety.int.spec.ts`: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `tests/chat-safety.int.spec.ts tests/chat.int.spec.ts tests/rls-chat.int.spec.ts`, `pnpm --filter mobile test`, `pnpm --filter @kando/i18n test`: PASS.
- [ ] **Step 5: Commit** `fix(security): limit chat sending to 30 messages in 10 minutes`.

### Task 7: Clean-up cron: blocked contact text, maxDuration, env example (28 d, 29)

**Files:** modify `packages/domain/src/chat/flags.ts`, `chat/rules.ts`, `packages/domain/src/index.ts`, `apps/web/app/api/cron/suspensions/route.ts` (Stage B Task 3 made it the clean-up route: it already runs `pruneOldRows` from `packages/domain/src/retention.ts`, which does not touch `contact_attempts`), `.env.example`; test `apps/web/tests/cron-suspensions.int.spec.ts`.

**Interfaces:**
- `CONTACT_ATTEMPTS_KEEP_DAYS = 90` in `chat/rules.ts` (staff read the last 20 attempts of an open flag, `chat/staff.ts:146`; 90 days covers any review). Owner may shorten it.
- `purgeContactAttempts(exec: typeof db, now = new Date()): Promise<number>` in `flags.ts`: deletes `contact_attempts` rows older than the keep period, returns the count; the suspensions route calls it after `pruneOldRows`.
- The suspensions route answers `contactAttempts` in its JSON and has `export const maxDuration = 60` (Stage B's Task 3 gives every cron route one; add it only if it is still missing).
- `.env.example` gains, each with a one-line comment: `PAYMENTS_ENABLED`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`, `EXPO_ACCESS_TOKEN`, `DELETE_RETENTION_MONTHS`, `TRANSLATE_GLOBAL_LIMIT_PER_DAY`, `ALLOW_PRODUCTION`, `SEED_USERS_FILE` (values empty).

- [ ] **Step 1: Write tests:** `the daily clean-up deletes contact attempts older than 90 days and keeps newer ones`, `the clean-up route declares maxDuration 60`, and in a small spec next to the env (`apps/web/tests/env-example.int.spec.ts`) `every process.env name used in the code is in .env.example` (scan `apps` and `packages` source for `process.env.NAME`; allow-list `NODE_ENV`, `VITEST`, `TZ`, `VERCEL_PROJECT_PRODUCTION_URL`, `EXPO_PUBLIC_API_URL` (mobile env file), `Stripe_Secret_Key` (legacy spelling)).
- [ ] **Step 2: Run** the specs: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the specs: PASS.
- [ ] **Step 5: Commit** `fix(security): delete blocked contact text after 90 days, cron duration, complete env example`.

### Task 8: Uploads capped without buffering (item 12)

**Files:** modify `packages/domain/src/app-request.ts` (the `maxBodyBytes` block only), `packages/domain/src/photos.ts`, `documents.ts`, `apps/web/tests/helpers.ts`; tests `apps/web/tests/app-request.int.spec.ts`, `apps/web/tests/files.int.spec.ts`.

**Interfaces:**
- `exceedsBytes(request: Request, max: number): Promise<boolean>` (module-private in `app-request.ts`): reads `request.clone().body` chunk by chunk and cancels the reader as soon as more than `max` bytes were seen; replaces the `arrayBuffer()` read.
- Order in the wrapper: a route with `prepare` (the three uploads: photos, files, chat photos) and no `Content-Length` → 411 `{ error: 'LENGTH_REQUIRED' }`; a declared length over the cap → 413 as today; then `exceedsBytes` → 413.
- `export const MAX_PIXELS = 25_000_000` in `photos.ts`; `documents.ts` imports it (its own constant is removed).
- `sized(request: Request): Promise<Request>` in `helpers.ts`: the same request with `content-length` set to its body's byte length; every upload test request goes through it.

- [ ] **Step 1: Write tests** in `app-request.int.spec.ts`: `an upload route without Content-Length is 411 before the handler runs`, `a body larger than declared is cut at the cap: 413` (a stream body that never ends after `max + 1` bytes; the test finishes, proving it was not read to the end), keep `a body over maxBodyBytes is 413 before the handler runs`. `files.int.spec.ts`: `an image over 25 megapixels is 400 Unsupported file type` (sharp-created 6000 × 4500 PNG, solid colour).
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run tests/app-request.int.spec.ts tests/files.int.spec.ts`: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the web suite `pnpm --filter web test`: PASS.
- [ ] **Step 5: Phone check before the pull request:** run `pnpm --filter web dev` with the phone on the LAN (`apps/mobile/.env.example`) and upload a portfolio photo, a document and a chat photo from Android and from iOS (development build). Every upload must succeed. If one fails with 411 (the app's fetch sent no length), remove the 411 rule (keep `exceedsBytes` and the pixel cap) and record it in the report's Open Items.
- [ ] **Step 6: Commit** `fix(security): cap upload bodies while reading, require Content-Length, 25 MP limit`.

### Task 9: script-src trial and HSTS (items 14, 29)

Choice: a fixed policy in `next.config.ts` with `script-src 'self' 'unsafe-inline'`, not nonces. Nonces force every page to render per request (`node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`, "Dynamic Rendering Requirement"), which undoes Stage B's cached public pages (item 23). The fixed policy stops scripts from other hosts; inline injection stays covered by React escaping and the escaping Markdown renderer (`apps/web/lib/markdown.ts`). `ponytail:` comment in the config: nonce policy for `/admin` (already rendered per request) when an inline-script risk appears there.

**Files:** modify `apps/web/next.config.ts`; test `apps/web/tests/security-headers.int.spec.ts`.

**Interfaces:**
- New header `Content-Security-Policy-Report-Only`: `script-src 'self' 'unsafe-inline'` plus `'unsafe-eval'` only when `NODE_ENV === 'development'` (React needs it there). The enforced `Content-Security-Policy` stays as today. Remove the old comment about script-src breaking Neon Auth redirects (redirects are not scripts; the trial checks it).
- New header `Strict-Transport-Security: max-age=63072000; includeSubDomains` (skillweb.space serves only the apex and `www`, both on Vercel with HTTPS; no `preload`, which is hard to undo).

- [ ] **Step 1: Write tests:** extend `every route gets the security headers…` with the two headers; `development adds unsafe-eval to the trial policy only` (re-import the config with `NODE_ENV` stubbed).
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run tests/security-headers.int.spec.ts`: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the spec: PASS.
- [ ] **Step 5: Commit** `fix(security): trial a script-src policy and send HSTS with subdomains`.

### Task 10: Back-office reads (items 11, 28 e)

**Files:** modify `packages/domain/src/admin/resources.ts` (`getProvider`), `admin/users.ts` (`getUser`, `suspendUser`), `admin/common.ts`; test `apps/web/tests/admin-api.int.spec.ts`.

**Interfaces:**
- `getProvider` returns an explicit list: `id, ownerId, ownerEmail, type, businessName, publicName, slug, bio, strengths, skills, experience, country, basePostcode, serviceRadiusKm, worksRemotely, impressum, status, suspended, suspendedUntil, createdAt, updatedAt, photos`. Never `stripeAccountId`, `payoutsReadyAt`, `taxNumber`, `vatId`, `legalStatus`, `invoiceConsentAt`, `location` (no screen shows them; Administrators see payment state in Stripe; add an Administrator-only block when a screen needs it).
- `isUserId(id: string): boolean` in `admin/common.ts`: `/^[A-Za-z0-9_-]{1,64}$/`. `getUser` and `suspendUser` answer 404 for anything else before querying.

- [ ] **Step 1: Write tests:** `a Reviewer and an Administrator reading a provider get no Stripe, tax or VAT field` (seed those columns through `pool`; assert the keys are absent), `a user id of 65 characters or with a slash is 404 for read and suspend`.
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run tests/admin-api.int.spec.ts`: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `tests/admin-api.int.spec.ts tests/admin-roles.int.spec.ts tests/admin-chat.int.spec.ts`; `npx tsc --noEmit` in `packages/domain` and `apps/web`: PASS.
- [ ] **Step 5: Commit** `fix(security): back office returns no payment or tax fields, checks user ids`.

### Task 11: Enforce the script-src policy (after the trial)

Trigger: the pull request's Vercel preview (`assessment-*` branches are deployed; only `stage-2*` is switched off in `apps/web/vercel.json`) was walked through in a desktop browser with the developer console open and showed **no** `Content-Security-Policy-Report-Only` violation on: home (`/` and `?lang=en`), a provider page, a legal page, `/payment-done`, `/payout-done`, `/admin/sign-in` (sign in and out), the admin dashboard, Documents, Users, Providers, Bookings, a dispute, Flags with a thread. If any page shows a violation, fix its cause or stop here, leave the policy report-only and list it in the report.

**Files:** modify `apps/web/next.config.ts`; test `apps/web/tests/security-headers.int.spec.ts`.

- [ ] **Step 1: Write the test:** the enforced `Content-Security-Policy` now ends with `; script-src 'self' 'unsafe-inline'` (development: plus `'unsafe-eval'`), and there is no `Content-Security-Policy-Report-Only` header.
- [ ] **Step 2: Run** the spec: FAIL. **Step 3: Implement** (move the directive into the enforced header). **Step 4: Run**: PASS.
- [ ] **Step 5: Commit** `fix(security): enforce the script-src policy`, then walk the same pages on the preview once more.

### Task 12: Test report and README

**Files:** create `Reports/Assessment-Stage-C-Test-Report.xlsx` (copy the layout of `Reports/Stage-2e-Test-Report.xlsx`); modify `README.md`.

- [ ] **Step 1: Run and paste** into the report: `pnpm --filter web test`, `pnpm --filter @kando/domain test`, `pnpm --filter @kando/contract test`, `pnpm --filter @kando/i18n test`, `pnpm --filter mobile test`, and `npx tsc --noEmit` in `apps/web`, `apps/mobile`, `packages/domain`, `packages/contract`, `packages/i18n`; `pnpm lint`.
- [ ] **Step 2: Report contents:** per finding (4, 9, 10, 11, 12, 14, 28 a to f, 29) what changed and which test proves it. Other Checks (not yet done unless done): delete an account with the right and a wrong password on a phone (and that the phone stays signed in after a wrong one); the upload phone check of Task 8; the CSP walkthrough of Task 11; a profile text with a phone number on a phone shows the contact text. Open Items: WAF rules and body-size rule (owner, Vercel dashboard), chat photos not checked for numbers, expiry notices now come with the cron run (daily until Vercel Pro), the 90-day keep period (owner may shorten), the nonce policy for `/admin` (not done), customer ids visible to providers (accepted).
- [ ] **Step 3: README:** add the row "Assessment Stage C" to the "Assessment fixes" table under "Stage 2 build progress" (branch, pull request, report, owner points: WAF rules, the phone checks). Update "What the app does today": deletion asks for the password; profile texts refuse contact details; chat sending is limited to 30 messages in 10 minutes. Update "Stage 2a" expiry wording ("expiry is checked whenever someone opens their list" becomes "a lapsed item shows as expired at once; its notice comes with the cron run").
- [ ] **Step 4: Commit** `docs: Stage C test report and README`.
