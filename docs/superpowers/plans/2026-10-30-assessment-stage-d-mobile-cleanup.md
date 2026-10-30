# Assessment Stage D: mobile flow and clean-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The app walks a booking from "accepted" to "confirmed" through Stripe's test gateway with the pay card right from the first render; every booking notice has an Open button and also shows on Home and My bookings; the account screen never hides a failure; the small button gaps are closed; duplicated helpers and constants live in one place; the app stops shipping the back-office and email texts once measurement shows the gain.

**Architecture:** The server tells the app whether payments are on (`Me.paymentsEnabled`) instead of the app learning it from the first refused tap. Notice targets reuse the same id-to-route mapping the push links already use. A failed session lookup at Neon Auth (429, 5xx) becomes a 503 `AUTH_BUSY`, not a sign-out. Shared constants move to `@kando/contract` (used by server and app), shared booking helpers to one domain file. The text catalogue gets a catalogue-free `lang` entry and an app entry without `admin.*` and `email.*`.

**Tech Stack:** existing stack (Expo SDK 58 with Expo Router, jest-expo; Next.js 16; Drizzle; vitest; Stripe test mode through `PaymentsGateway`). Nothing new installed.

**Spec:** `docs/superpowers/specs/2026-10-30-assessment-findings.md` (items 1, 3, 20, 26, 27, 30, 31). Builds on Stage A (`2026-10-30-assessment-stage-a-database-connections.md`), Stage B (`2026-10-30-assessment-stage-b-server-flow-efficiency.md`) and Stage C (`2026-10-30-assessment-stage-c-security.md`), all merged first. Read `apps/mobile/AGENTS.md` (Expo docs for SDK 58, never memory) and `apps/web/AGENTS.md` (Next.js docs in `node_modules/next/dist/docs/`).

## Findings covered (verified in code on `release/assessment-fixes` at 7617df9)

- **1 (Critical) Pay flow.** Confirmed: the app learns that payments are off only from the 503 `PAYMENTS_OFF` of the first tap (`apps/web/app/app-api/v1/bookings/[id]/pay/route.ts:6`, `apps/mobile/src/lib/payments-off.ts:12-15`), so the card first shows "Pay now" and only after the tap "payments are off" (`pay-card.tsx:92`); notify-me and the payout card do the same. With `PAYMENTS_ENABLED=true` the server path (pay link, webhook, confirm at `packages/domain/src/payments/webhook.ts:81-91`) is covered with the fake gateway (`apps/web/tests/payments.int.spec.ts:82-560`) but never walked against the real test gateway: `pnpm payments:smoke` stops at an unpaid session (`packages/domain/scripts/stripe-smoke.ts:44`) and nothing checks that the deployment's webhook is reachable (Deployment Protection, payments off on that deployment). `booking-detail.tsx:31-36` finds the booking by downloading both lists (Stage B adds the read-one route).
- **3 (High) Booking notices without Open.** Confirmed: `notificationTarget` (`apps/mobile/src/lib/notification-text.ts:72-78`) knows only customers-waiting, commission-invoice-ready and provider-available; the ids are in the payload (`packages/domain/src/bookings/notify.ts:60`); the push link for the same notice already maps them (`notify.ts:25-29`, `apps/mobile/src/lib/push.ts:52-56`). Banners render only on `account-screen.tsx:90` and `setup-screen.tsx:64`.
- **20 (Medium) Account screen hides failures.** Confirmed: a failed `/me` is swallowed (`account-screen.tsx:45-47`), the error text sits inside `{me && ...}` (`:100`), so the "Offer services" error never shows when `/me` failed; `start-offering.ts:21` returns `errorText('')`, which is `error.generic` (`packages/i18n/src/en.ts:40`), exactly the owner's message. Also found: `apps/web/lib/auth/server.ts:28` treats every non-OK get-session answer (the 429 in the preview log, README "Fixes from the owner's phone testing") as signed out, so a write answers 401 and `apps/mobile/src/api/client.ts:160` signs the phone out; an unmapped `Unauthorized` gives the same generic text.
- **26 (Low) Invalid byte.** Confirmed: `apps/mobile/src/screens/my-profile/service-screen.tsx:160` holds byte 0x85 (a Windows-1252 ellipsis); `file` reports "NEL line terminators".
- **27 (Low) Button gaps.** Confirmed: `notify-me.tsx:12` starts `off` and never reads the saved watch; `verify-email-screen.tsx:34-41` resend has no busy state; `request-detail.tsx:46-48` (Accept to the time form) and `request-actions.tsx:30` (Book) push a route per tap; `apps/web/lib/admin/auth-provider.ts:14,17` always `t('de', ...)`.
- **30 (Low) Duplication.** Confirmed: cron secret check in `api/cron/bookings/route.ts:19-23` and `api/cron/suspensions/route.ts:7-11`; `partyOf` (`bookings/bookings.ts:77`) and `sideOf` (`bookings/finish.ts:24`); `lockRow` twice (`bookings.ts:84`, `finish.ts:30`); `notFound` in 7 domain files and 3 web routes; `HOUR`/`DAY` in 12 domain files and the app; `NO_ID` in `bookings.ts:20`, `requests.ts:23`; the app copies `LATE_CANCEL_PERCENT`, `FREE_CANCEL_HOURS`, `STOP_ANSWER_DAYS` (`apps/mobile/src/lib/booking-status.ts:26-28`, kept equal by a test at `booking-status.test.ts:169`).
- **31 (Low) Bundle.** Confirmed: 191 `admin.*` and 120 `email.*` keys per language (`packages/i18n/src/en.ts`) reach the app through `apps/mobile/src/i18n/index.ts:1` and also through `@kando/contract` (`packages/contract/src/providers.ts:1` imports `DEFAULT_LANG` from the catalogue index, which imports both catalogues). The domain barrel re-exports four test hooks (`email.ts:19`, `push.ts:49`, `storage.ts:44`, `payments/gateway.ts:74`); the domain is server-only, so this is hygiene, not app size.

Out of scope here (owner design talk first): the inbox with a navigation bar and a "tentative" booking state (owner phone-test item 5).

## Global Constraints

- Branch `assessment-d-mobile-cleanup` from `release/assessment-fixes` after Stages A, B and C are merged; one pull request into `release/assessment-fixes`; the owner merges.
- TDD: a failing test first for every logic change. Mobile tests are jest next to the file (`apps/mobile/src/lib/*.test.ts`, run `pnpm --filter mobile test -- <path>`); screens stay thin and call tested `lib/` functions. Web tests are `apps/web/tests/*.int.spec.ts` (vitest, Docker Postgres on 5433: `docker compose up -d --wait db`), run `pnpm --filter web exec vitest run <file>`. Domain, contract and i18n use vitest (`pnpm --filter @kando/<pkg> test`).
- Every new user-facing text in German and English in `packages/i18n/src/de.ts` and `en.ts` (the parity test `packages/i18n/src/index.test.ts` must pass); never a raw server code on screen.
- No new dependencies. No migration is expected (0025 is reserved for this stage if one is needed).
- `LIVE_PAYMENTS_ALLOWED` stays `false`; only Stripe test keys. Never paste a key into a commit, a report or a chat.
- Germany-agnostic: no new country or currency literals.
- Commit messages carry no AI co-author or "Generated with" lines.
- Before each task, re-grep the files it names: Stages A to C changed `app-request.ts`, `users.ts`, `bookings.ts`, `finish.ts`, `requests.ts`, `timers.ts` and the cron routes after this plan was written.

## Review Focus

- An app build newer than the server (no `paymentsEnabled` in `/me`): the card behaves as today (Pay now, and "payments are off" after a refused tap), never hides Pay when payments are on (Task 1 test `paymentsOff is false when /me lacks the flag`).
- Neon Auth answers 429 or 5xx while the phone writes: 503 `AUTH_BUSY`, the phone stays signed in and shows "busy, try again" (Task 4 test `a 429 from the session lookup is 503 AUTH_BUSY`; the busy text itself is Stage C's).
- A notice whose payload id is malformed or belongs to a booking the person can no longer see: no Open for a malformed id; the booking screen shows Not found with Retry, never a crash (Task 3 test `a malformed id gives no target`).
- Two quick taps on Accept, Book or a notice Open: one screen pushed (Task 6 test `the same route twice within 1 s navigates once`).
- The payment confirmation arrives while the customer is still on the Stripe page or after the app was closed: on return or reopen the booking reads confirmed and the card says paid (Task 2 test `pay link, paid event, then the booking reads confirmed`).

## File structure

- Contract: `packages/contract/src/me.ts` (`paymentsEnabled`), `providers.ts` (`watching`), `common.ts` (`HOUR`, `DAY`), `endings.ts` (cancellation constants).
- Domain: `packages/domain/src/users.ts` (`toMe`), `public-profile.ts` (`watching`), new `packages/domain/src/bookings/party.ts` (`partyOf`, `lockRow`), `providers/http.ts` (`notFound`), `admin/common.ts` (`NO_ID`), `app-request.ts` (`AuthUnavailableError`), new `packages/domain/src/testing.ts`, `index.ts`.
- Web: `apps/web/lib/auth/server.ts`, new `apps/web/lib/cron-auth.ts` (unless Stage B made one), `apps/web/lib/admin/auth-provider.ts`, `apps/web/lib/admin/lang.ts`, the cron routes, three item routes (`files/[id]`, `references/[id]`, `services/[id]`).
- Mobile: `lib/payments-off.ts`, `lib/notification-text.ts`, `lib/start-offering.ts`, `lib/go.ts`, `lib/booking-status.ts`, `components/notification-banner.tsx`, `components/auth-ui.tsx`, `i18n/index.ts`, screens `account-screen.tsx`, `home/home-screen.tsx`, `bookings/my-bookings.tsx`, `bookings/booking-detail.tsx`, `bookings/pay-card.tsx`, `provider/notify-me.tsx`, `setup/payout-card.tsx`, `auth/verify-email-screen.tsx`, `my-profile/service-screen.tsx`.
- i18n: new `packages/i18n/src/lang.ts`, `app.ts`, `de-server.ts`, `en-server.ts`; `index.ts`, `package.json` (`exports`).
- Script: `packages/domain/scripts/stripe-smoke.ts` (webhook reachability step).

### Task 1: The app knows from the start whether payments are on

**Files:** modify `packages/contract/src/me.ts`, `packages/domain/src/users.ts` (`toMe`), `apps/mobile/src/lib/payments-off.ts`, `pay-card.tsx`, `notify-me.tsx`, `payout-card.tsx`; test `apps/web/tests/payments.int.spec.ts`, `apps/mobile/src/lib/payments-off.test.ts`.

**Interfaces:**
- Produces: `MeSchema.paymentsEnabled: z.boolean().optional()` (optional: an older server lacks it). `toMe` sets it from `paymentsEnabled()`.
- Produces (mobile): `paymentsOff(me?: Pick<Me, 'paymentsEnabled'> | null): boolean`: true when `me?.paymentsEnabled === false` or a `PAYMENTS_OFF` answer was noted this session; false when the flag is true (a stale noted "off" from an earlier session state is cleared by `noteMe`). `noteMe(me: Me): void` called by `loadMe` so the flag follows every `/me` load. Screens pass `useMe()`.

- [ ] **Step 1: Write tests.** Web: `GET /me carries paymentsEnabled true with PAYMENTS_ENABLED=true and false without it`. Mobile: `paymentsOff is true when /me says paymentsEnabled false before any tap`, `paymentsOff is false when /me says true even after an old PAYMENTS_OFF note`, `paymentsOff is false when /me lacks the flag` (then only a noted `PAYMENTS_OFF` turns it on).
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run tests/payments.int.spec.ts -t paymentsEnabled` and `pnpm --filter mobile test -- src/lib/payments-off.test.ts`: FAIL.
- [ ] **Step 3: Implement** the field, `toMe`, `paymentsOff(me)`, `noteMe` in `hooks/use-me.ts`'s `set`, and pass `useMe()` in the three screens (pay card: the off text instead of Pay now from the first render).
- [ ] **Step 4: Run** the same commands: PASS. `npx tsc --noEmit` in `packages/contract`, `packages/domain`, `apps/mobile`: clean.
- [ ] **Step 5: Commit** `fix(mobile): pay card knows from the start whether payments are on`.

### Task 2: The whole pay path, fake gateway and Stripe test gateway

**Files:** modify `apps/mobile/src/screens/bookings/booking-detail.tsx` (only if Stage B left it on `find()` over both lists), `packages/domain/scripts/stripe-smoke.ts`, `README.md` ("Stripe test-mode set-up (owner)"); test `apps/web/tests/payments.int.spec.ts`.

**Interfaces:**
- Consumes (Stage B, Task 7): `GET /app-api/v1/bookings/[id]` answering `{ booking: Booking; viewer: 'customer' | 'provider'; threadId: string | null }`, mobile `getBooking(id: string)` in `apps/mobile/src/api/bookings.ts`; Stage B already switched `booking-detail.tsx` to it. Stage A's pay route answers through an `AfterTransaction` (same request and answer shape).
- Produces: smoke step `e webhook reachable`: POST `${NEXT_PUBLIC_SERVER_URL}/api/stripe/webhook` with body `{}` and header `stripe-signature: t=0,v1=bad`. 400 JSON is PASS; 404 FAIL "payments are off on that deployment"; 401, 403 or an HTML answer FAIL "Deployment Protection blocks Stripe: add the bypass to the webhook URL"; a network error FAIL; SKIPPED without `NEXT_PUBLIC_SERVER_URL`.

- [ ] **Step 1: Write test** `pay link, paid event, then the booking reads confirmed` (one test through the route handlers: a payouts-ready provider and an accepted booking; POST `/bookings/[id]/pay` returns the fake gateway's https URL; POST `/api/stripe/webhook` with the fake signed `checkout-paid` event returns 200; GET `/bookings/[id]` (Stage B) answers status `confirmed` and a non-null `payBy`; the same event again changes nothing and the customer has exactly one `payment-received` notification).
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run tests/payments.int.spec.ts -t "reads confirmed"`: FAIL only if the read-one route is missing or wrong; if it passes at once, note it in the report (the server path was already right) and keep the test.
- [ ] **Step 3: Implement** the booking screen load through `getBooking` (if still needed) and the smoke step `e`.
- [ ] **Step 4: Run** the test: PASS. Run `pnpm payments:smoke` locally with the test key (steps a to d PASS, e SKIPPED or PASS against the Preview URL).
- [ ] **Step 5: Write the manual test run into README "Stripe test-mode set-up (owner)"** as new numbered steps: (a) local: `stripe listen --forward-to localhost:3000/api/stripe/webhook --events checkout.session.completed,checkout.session.async_payment_succeeded,charge.dispute.created,refund.failed,account.updated`, put the printed `whsec_...` in `.env` as `STRIPE_WEBHOOK_SECRET` and `STRIPE_CONNECT_WEBHOOK_SECRET`, `pnpm --filter web dev`, phone with `EXPO_PUBLIC_API_URL=http://<PC LAN address>:3000`; (b) Preview: both webhook endpoints on the Preview URL with `?x-vercel-protection-bypass=<Protection Bypass for Automation secret>`, their secrets on Preview only, `PAYMENTS_ENABLED=true` on Preview only, then `pnpm payments:smoke` step e PASS; (c) the test provider finishes the Stripe-hosted payout set-up with Stripe's test data and accepts the invoice consent (with payments on, `canTransact` refuses a provider who has not; `packages/domain/src/payments/rules.ts:72`); (d) the walk: request, quote, accept, provider accepts the time, Pay now, card 4242 4242 4242 4242, back to the app, "being confirmed", Refresh, "Paid"; then 4000 0000 0000 0002 (declined, stays awaiting payment) and 4000 0027 6000 3184 (3-D Secure).
- [ ] **Step 6: Commit** `test(payments): walk the pay path end to end; smoke checks the webhook is reachable`.

### Task 3: Open on every booking notice, and notices on Home and My bookings

**Files:** modify `apps/mobile/src/lib/notification-text.ts`, `components/notification-banner.tsx`, `screens/home/home-screen.tsx`, `screens/bookings/my-bookings.tsx`; test `apps/mobile/src/lib/notification-text.test.ts`.

**Interfaces:**
- Produces: `notificationTarget(n)` additionally returns, for any kind not handled by the existing rules and not `profile-live` or `message-received`: `{ path: '/bookings/<bookingId>' }` when the payload has `bookingId`, else `{ path: '/bookings/request/<requestId>' }` for `requestId`, else `{ path: '/bookings' }` for `requests-ignored` and `provider-warning`. Ids must match `/^[\w-]{1,100}$/` (the rule `pushRoute` uses), else no target. Stage B adds the kinds `request-withdrawn` `{requestId}`, `request-declined` `{requestId}` and `request-reopened` `{requestId, bookingId}`: the first two follow the requestId rule; `request-reopened` is the one exception to "bookingId first" and opens `/bookings/request/<requestId>` (the booking it names has ended).
- Produces: `isBookingNotice(n: Notification): boolean` (has a booking or request id, or is `requests-ignored` / `provider-warning`). `NotificationBanners({ me, canShare?, only? }: { me: Me | null; canShare?: boolean; only?: (n: Notification) => boolean })`.
- Home shows all open notices (as the account page does); My bookings shows `only={isBookingNotice}`. Both reload `/me` on focus (`useFocusEffect(() => { loadMe().catch(() => {}) })`), no polling.

- [ ] **Step 1: Write tests** `every booking kind with a bookingId opens the booking` (loop over every `NOTIFICATION_KINDS` entry except profile-live, message-received, provider-available, customers-waiting, commission-invoice-ready: target path `/bookings/b-1`), `a requestId alone opens the request`, `request-reopened opens the request, not the ended booking` (payload `{ requestId: 'r-1', bookingId: 'b-1' }`: path `/bookings/request/r-1`), `requests-ignored opens the list`, `a malformed id gives no target` (`'../x'`, 101 characters), `isBookingNotice is false for profile-live and message-received`.
- [ ] **Step 2: Run** `pnpm --filter mobile test -- src/lib/notification-text.test.ts`: FAIL.
- [ ] **Step 3: Implement** the target rule, `isBookingNotice`, the `only` prop and the two screens.
- [ ] **Step 4: Run**: PASS; `npx tsc --noEmit` in `apps/mobile`: clean.
- [ ] **Step 5: Commit** `feat(mobile): every booking notice opens its booking; notices on Home and My bookings`.

### Task 4: A busy login server is not a sign-out

**Files:** modify `packages/domain/src/app-request.ts`, `apps/web/lib/auth/server.ts`; test `apps/web/tests/app-request.int.spec.ts`, `apps/web/tests/auth-session.int.spec.ts` (new).

**Interfaces:**
- Produces: `export class AuthUnavailableError extends Error` in `packages/domain/src/app-request.ts`; `createAppRequest` answers it with 503 `{ error: 'AUTH_BUSY' }` (logged without the cookie).
- Produces: `sessionFromAuthResponse(res: Response): Promise<Session | null>` in `apps/web/lib/auth/server.ts`: OK with a user gives the session, OK without one gives null, 401 gives null, any other status throws `AuthUnavailableError`. `sessionFromRequest` uses it.
- Consumes from Stage C (Tasks 1 and 2): the error code `AUTH_BUSY` (503), the text key `error.authBusy` (DE and EN) and its mobile mapping `AUTH_BUSY: 'error.authBusy'`. Reuse them; do not add them again. This task only adds the session-lookup path that raises it.

- [ ] **Step 1: Write tests** `a 429 from the session lookup is 503 AUTH_BUSY` (createAppRequest with a resolver that throws `AuthUnavailableError`), `sessionFromAuthResponse: 200 user, 200 null, 401, 429, 500`. (Stage C already tests that `AUTH_BUSY` has its own mobile text.)
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run tests/app-request.int.spec.ts tests/auth-session.int.spec.ts`: FAIL.
- [ ] **Step 3: Implement.** The phone signs out only on 401 (`client.ts:160` stays as is).
- [ ] **Step 4: Run**: PASS; `npx tsc --noEmit` in `packages/domain` and `apps/web`: clean.
- [ ] **Step 5: Commit** `fix(auth): a busy login server answers 503 instead of signing the phone out`.

### Task 5: The account screen shows every failure

**Files:** modify `apps/mobile/src/screens/account-screen.tsx`, `apps/mobile/src/lib/start-offering.ts`, `packages/i18n/src/de.ts`, `en.ts`; test `apps/mobile/src/lib/start-offering.test.ts`.

**Interfaces:**
- Produces: `startOffering` returns `errorText('OFFER_NOT_SAVED')` (new key `error.offerNotSaved`, "Your provider profile could not be set up. Please try again.") when `/me` still says not a provider, and `errorText(code)` otherwise (so `AUTH_BUSY`, `network`, `SUSPENDED`, `EMAIL_NOT_VERIFIED` get their own texts).
- Account screen: `load` keeps the error code (`loadError: string | null`); while `me` is null and `loadError` is set it shows `ErrorRetry code={loadError} onRetry={load}` (from `components/state-view`); `<ErrorText text={error} />` moves out of the `me &&` block, under the links, so the Offer-services error always shows.

- [ ] **Step 1: Write tests** `a draft that does not make a provider gives the offer-not-saved text`, `a network failure gives the network text`, `AUTH_BUSY gives the busy text`.
- [ ] **Step 2: Run** `pnpm --filter mobile test -- src/lib/start-offering.test.ts`: FAIL.
- [ ] **Step 3: Implement** the mapping and the screen changes.
- [ ] **Step 4: Run**: PASS; i18n parity PASS; `npx tsc --noEmit` in `apps/mobile`: clean.
- [ ] **Step 5: Add to the Stage D report (Other Checks):** retest "Offer services" on the Preview with the Vercel log open (Functions log filtered to `/app-api/v1/provider-profile` and `/api/auth/get-session`); record the status and code the app got.
- [ ] **Step 6: Commit** `fix(mobile): account screen shows a failed load and the offer-services error`.

### Task 6: Small mobile gaps: ellipsis, resend busy, one push per tap

**Files:** modify `apps/mobile/src/screens/my-profile/service-screen.tsx:160`, `apps/mobile/src/components/auth-ui.tsx` (`LinkText`), `apps/mobile/src/screens/auth/verify-email-screen.tsx`, `apps/mobile/src/lib/go.ts`; test `apps/mobile/src/lib/source-encoding.test.ts` (new), `apps/mobile/src/lib/go.test.ts` (new).

**Interfaces:**
- Produces: `navGuard(windowMs = 1000): (href: string, now?: number) => boolean` in `lib/go.ts` (false for the same href again within the window); `go` and `goReplace` skip a guarded repeat. Covers Accept (`request-detail.tsx:48`), Book (`request-actions.tsx:30`) and notice Open buttons at once.
- `LinkText` gets `disabled?: boolean` (dimmed, `accessibilityState={{ disabled }}`); resend sets `resending` while the call runs.
- Service screen line 160 shows `…` (U+2026); the file is saved as UTF-8 with LF or the repo's usual line ends (no NEL).

- [ ] **Step 1: Write tests** `no source file under src holds U+FFFD or invalid UTF-8` (reads every `.ts`/`.tsx` under `apps/mobile/src` with `fs`, `Buffer.toString('utf8')` must not contain `�`), `the same route twice within 1 s navigates once`, `a different route or after 1 s navigates again`.
- [ ] **Step 2: Run** `pnpm --filter mobile test -- src/lib/source-encoding.test.ts src/lib/go.test.ts`: FAIL (the encoding test names `service-screen.tsx`).
- [ ] **Step 3: Implement** the three changes.
- [ ] **Step 4: Run**: PASS; `npx tsc --noEmit` and `npx expo lint` in `apps/mobile`: clean.
- [ ] **Step 5: Commit** `fix(mobile): ellipsis, resend busy state, one navigation per tap`.

### Task 7: Notify-me shows the saved state

**Files:** modify `packages/contract/src/providers.ts` (`ProviderDetail`), `packages/domain/src/public-profile.ts`, `apps/mobile/src/screens/provider/notify-me.tsx`, `provider-screen.tsx`; test `apps/web/tests/payouts.int.spec.ts` (where the notify-me tests live).

**Interfaces:**
- Produces: `ProviderDetail.watching: z.boolean().nullish()`: true when the caller has an `availability_watches` row for this provider with `notified_at IS NULL`; read on the request `tx` (row security limits it to the caller's own rows); false for an anonymous caller. The website page renders anonymously, so a cached site page never holds a person's flag.
- `NotifyMe({ slug, watching }: { slug: string; watching: boolean })` starts from `watching`.

- [ ] **Step 1: Write test** `the provider page says watching after notify-me, not after the undo, and never to an anonymous caller`.
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run tests/payouts.int.spec.ts -t watching`: FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run**: PASS; `npx tsc --noEmit` in `packages/contract`, `packages/domain`, `apps/mobile`: clean.
- [ ] **Step 5: Commit** `fix(mobile): notify-me starts from the saved state`.

### Task 8: Back-office sign-in errors in the back-office language

**Files:** modify `apps/web/lib/admin/lang.ts`, `apps/web/lib/admin/auth-provider.ts`; test `apps/web/tests/admin-lang.int.spec.ts`.

**Interfaces:**
- Produces: `browserAdminLang(cookie: string, languages: readonly string[]): Lang` in `lang.ts` (reads `admin-lang=` from a cookie string, else the first supported browser language, else `DEFAULT_LANG`; reuses `adminLang`). `authProvider.login` uses `browserAdminLang(document.cookie, navigator.languages)` for both messages.

- [ ] **Step 1: Write tests** `browserAdminLang: cookie en wins, then the browser languages, then de`, and `login failure text follows admin-lang=en` (mock `@neondatabase/auth/next`'s `createAuthClient` and `fetch`; set `document.cookie`-like input through a stubbed global).
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run tests/admin-lang.int.spec.ts`: FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run**: PASS.
- [ ] **Step 5: Commit** `fix(admin): sign-in errors in the back-office language`.

### Task 9: One copy of each shared helper and constant

**Files:** create `packages/domain/src/bookings/party.ts`; modify `packages/contract/src/common.ts`, `packages/contract/src/endings.ts`, `packages/domain/src/providers/http.ts`, `packages/domain/src/admin/common.ts`, every domain file listed under item 30 above (re-grep: `grep -rnE "^(export )?const (notFound|HOUR|DAY|NO_ID)\b" packages apps`), `packages/domain/src/bookings/ending-rules.ts`, `apps/mobile/src/lib/booking-status.ts`, the three web item routes, the cron routes (Stage B already created `cronAuthorized` in `apps/web/lib/cron.ts`; only confirm every cron route, `suspensions` included, uses it); tests: the existing suites.

**Interfaces:**
- Produces in `@kando/contract`: `HOUR = 3_600_000`, `DAY = 86_400_000` (`common.ts`); `LATE_CANCEL_SHARE = 0.5`, `FREE_CANCEL_HOURS = 24`, `STOP_ANSWER_DAYS = 7`, `NO_SHOW_OBJECTION_HOURS = 48` (`endings.ts`). `ending-rules.ts` and the app import them; the app's `LATE_CANCEL_PERCENT` goes (the cancel text uses `LATE_CANCEL_SHARE * 100`).
- Produces in the domain: `notFound(): never` in `providers/http.ts` (`fail(404, { error: 'Not found' })`; also used by the web routes, since `appRequest` returns a thrown Response as is); `NO_ID` in `admin/common.ts` beside `isUuid`; `partyOf(tx: Tx, userId: string, bookingId: string): Promise<{ role: 'customer' | 'provider'; providerId: string }>` and `lockRow(o: Exec, id: string)` in `bookings/party.ts`; `finish.ts`'s `sideOf` becomes `(await partyOf(...)).role` at its call sites and is removed. `admin/common.ts`'s Response-returning `notFound` stays only if admin routes rely on returning it (re-grep; else they use the throwing one).
- Consumes from Stage B: `cronAuthorized(request: Request): boolean` in `apps/web/lib/cron.ts`.

- [ ] **Step 1: Write test** `the app's cancellation constants are the server's` becomes a contract test `packages/contract/src/endings.test.ts`: `LATE_CANCEL_SHARE is 0.5, FREE_CANCEL_HOURS 24, STOP_ANSWER_DAYS 7, NO_SHOW_OBJECTION_HOURS 48`; delete the equality test in `booking-status.test.ts:169-173` (the copy it guarded is gone).
- [ ] **Step 2: Run** `pnpm --filter @kando/contract test`: FAIL (constants missing).
- [ ] **Step 3: Implement** the moves; no behaviour change.
- [ ] **Step 4: Run** every suite: `pnpm --filter @kando/contract test`, `pnpm --filter @kando/domain test`, `pnpm --filter web test`, `pnpm --filter mobile test`: PASS with the same counts as before plus the new test; `npx tsc --noEmit` in the four packages: clean; `grep -rnE "^(export )?const (notFound|HOUR|DAY|NO_ID)\b" packages/domain apps/web/app apps/mobile/src/lib --include=*.ts` lists nothing outside the shared files (test files may keep local time constants).
- [ ] **Step 5: Commit** `refactor: one copy of the booking helpers, time and cancellation constants`.

### Task 10: The app ships only its own texts (measured first)

**Files:** create `packages/i18n/src/lang.ts`, `app.ts`, `de-server.ts`, `en-server.ts`; modify `packages/i18n/src/index.ts`, `de.ts`, `en.ts`, `package.json`, `index.test.ts`, `packages/contract/src/providers.ts`, `apps/mobile/src/i18n/index.ts`, `apps/mobile/src/lib/format.ts`, `apps/mobile/src/lib/share-profile.ts`.

**Interfaces:**
- Produces: `@kando/i18n/lang` (`Lang`, `LANGS`, `DEFAULT_LANG`, `isLang`, `acceptLang`, `LOCALE`, `TIME_ZONE`; imports no catalogue); `@kando/i18n/app` (`AppKey = keyof typeof de` after the move, `t(lang, key: AppKey, params?)`, `formatMoney`, `formatPrice`, plus the `lang` exports); `@kando/i18n` (unchanged API: `Key = AppKey | keyof typeof deServer`, `t` over both, `de`, `en` merged for the parity tests). `package.json` `exports`: `"."`, `"./app"`, `"./lang"`, each to its `src/*.ts`.
- `de-server.ts` / `en-server.ts` hold every `admin.*` and `email.*` entry (moved, not changed).
- The app imports only `@kando/i18n/app`; `@kando/contract` imports `DEFAULT_LANG` from `@kando/i18n/lang`.

- [ ] **Step 1: Measure.** `cd apps/mobile && npx expo export --platform android --output-dir ../../.work/bundle-before`, note the size of `_expo/static/js/android/*.hbc`; then count the catalogue's share: `node -e` summing `Buffer.byteLength` of every `admin.*` and `email.*` value in `de.ts` and `en.ts`. Write both numbers into the report.
- [ ] **Step 2: Decide.** Continue only if the `admin.*` plus `email.*` text is at least 30 KB or 1 % of the bundle; otherwise record "measured, not worth it" in the report and README, and skip to Task 11.
- [ ] **Step 3: Write tests** in `packages/i18n/src/index.test.ts`: `server catalogues have the same keys in DE and EN`, `the app catalogue has no admin. or email. key`, `lang.ts imports no catalogue` (read the file text; no `./de` import); the existing parity test walks the merged catalogue.
- [ ] **Step 4: Run** `pnpm --filter @kando/i18n test`: FAIL.
- [ ] **Step 5: Implement**; check Metro resolves the `exports` subpaths for SDK 58 (Expo docs "Metro, package exports"); if it does not, import `@kando/i18n/src/app` instead, as the web tests already do for `@kando/domain/src/seed/...`.
- [ ] **Step 6: Run** every package's tests and `npx tsc --noEmit` in `packages/i18n`, `packages/contract`, `packages/domain`, `apps/web`, `apps/mobile`: PASS and clean; export again to `.work/bundle-after` and note the new size in the report.
- [ ] **Step 7: Commit** `perf(mobile): the app bundle carries no back-office or email texts`.

### Task 11: Test hooks out of the domain barrel

**Files:** create `packages/domain/src/testing.ts`; modify `packages/domain/src/index.ts`; the web test files that import `setGatewayForTests`, `setStorageForTests`, `outboxForTests`, `pushOutboxForTests` (32 files, re-grep); test `packages/domain/src/testing.test.ts` (new).

**Interfaces:**
- Produces: `packages/domain/src/testing.ts` re-exports the four hooks from their modules. `index.ts` replaces `export * from './email' | './push' | './storage' | './payments/gateway'` with explicit export lists that leave out the hooks. Tests import `@kando/domain/src/testing` (the deep-path style already used for the seeds; no `exports` field on the domain package, so the existing deep imports keep working).

- [ ] **Step 1: Write test** `the barrel exports no *ForTests hook; testing.ts exports all four`.
- [ ] **Step 2: Run** `pnpm --filter @kando/domain test -- src/testing.test.ts`: FAIL.
- [ ] **Step 3: Implement** and switch the test imports.
- [ ] **Step 4: Run** `pnpm --filter @kando/domain test` and `pnpm --filter web test`: PASS; `npx tsc --noEmit` in `packages/domain` and `apps/web`: clean.
- [ ] **Step 5: Commit** `refactor(domain): test hooks behind a testing entry`.

### Task 12: Test report and README

**Files:** create `Reports/Assessment-Stage-D-Test-Report.xlsx` (copy the sheets and layout of `Reports/Stage-2e-Test-Report.xlsx`); modify `README.md`.

- [ ] **Step 1: Run and paste** into the report: `pnpm --filter mobile test`, `pnpm --filter web test`, `pnpm --filter @kando/domain test`, `pnpm --filter @kando/contract test`, `pnpm --filter @kando/i18n test`, and `npx tsc --noEmit` in each of `apps/mobile`, `apps/web`, `packages/domain`, `packages/contract`, `packages/i18n`, `packages/db`; `pnpm lint`; `npx expo lint` in `apps/mobile`. Every count, pass and fail.
- [ ] **Step 2: Other Checks sheet** (all "Not yet done"): the Stripe walk of Task 2 step 5 (4242, declined card, 3-D Secure, close before paying, Refresh, Pay again) on Android and iPhone; payments-off text from the first render with `PAYMENTS_ENABLED` unset; every booking notice's Open on Home, My bookings and Account; airplane mode on the Account tab (Retry shows) and on Offer services (network text); the Offer-services retest with the server log (Task 5 step 5); resend code busy; double tap on Accept and Book; notify-me after reopening the provider page; back-office sign-in error in English; bundle sizes before and after.
- [ ] **Step 3: README:** a row "Assessment Stage D" in a new "Assessment fixes (30 October 2026)" table under "Stage 2 build progress" (branch, pull request, report, what is left for the owner: the inbox and "tentative" design talk, the Stripe Preview set-up of Task 2 step 5); fix the stale note in `packages/domain/src/origin.ts`'s comment only if Stage C has not (the app does send an `Origin`, `apps/mobile/src/api/client.ts:86-87`).
- [ ] **Step 4: Commit** `docs: Stage D test report and README`.
