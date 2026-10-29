# Stage 2c: payments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Providers set up payouts with Stripe (Stripe-hosted, giving the verified mark); a customer pays the full amount through a pay link once the provider has accepted, which confirms the booking; Stripe holds the money and KANDO's code only tells Stripe when to release or refund it; every money movement is an append-only ledger row; all of it is behind `PAYMENTS_ENABLED`, off by default and Stripe test mode only.

**Architecture:** A `PaymentsGateway` interface in `packages/domain/src/payments/gateway.ts` with a Stripe implementation and a fake for tests (set like `setStorageForTests`). Money state lives on plan 2a's `bookings` row (new staff-only columns) and in a staff-only `ledger_entries` table that a trigger keeps append-only. One function, `settle`, splits a paid booking into refund, transfer and commission; plan 2d calls it for every ending. Webhooks are verified, recorded by event id and processed once.

**Tech Stack:** existing stack plus the `stripe` Node package in `packages/domain` (pin the current version; set the API version explicitly). Mobile opens Stripe-hosted pages with the already-installed `expo-web-browser`; no Stripe native module.

**Spec:** `docs/superpowers/specs/2026-10-29-stage-2-booking-and-money-design.md` (sections 3.4, 3.11, 4, 7a "How money is held" and "Commission", 9, 9a). Builds on plan 2a (`docs/superpowers/plans/2026-10-29-stage-2a-requests-quotes-bookings.md`) and plan 2b (`2026-10-29-stage-2b-chat.md`: `flagForStaff`, `StaffFlagKind`). Before writing Stripe code, load the `stripe:stripe-best-practices` skill and read the current Stripe Connect docs; never write Stripe calls from memory.

## Global Constraints

- `PAYMENTS_ENABLED` (environment) is off unless exactly `'true'`. Off: pay, payout set-up and webhook routes answer 503 `PAYMENTS_OFF` (webhook: 404), the app shows `payments.off` text, and the unfinished-provider rule does not apply. Only Stripe test keys are accepted (`sk_test_`/`rk_test_`); `LIVE_PAYMENTS_ALLOWED = false` is a constant, so real money needs a reviewed code change after the lawyer clears spec section 9.
- The customer pays the full agreed amount up front, after the provider accepts; no deposits. The booking is `confirmed` only when the payment succeeded; a failed payment leaves it `awaiting-payment` until its `payBy` (plan 2a).
- Stripe holds the money, never KANDO's own bank account. KANDO's code only instructs release or refund. An authorise-and-capture hold is not enough (it lasts only about 7 days). The held period runs from payment to release (up to about 7 days after "Finished") plus up to 14 working days if disputed. Payout to the provider within 7 days of the release.
- Commission: one percentage on the total the customer pays, processing fees inside it, no customer-side fee. `COMMISSION_RATE` is a single global constant, a PLACEHOLDER (`0.12`) until the owner decides; it is copied to `bookings.commission_rate` at the moment of payment so a later change never alters old bookings. Commission is paid only on the amount actually paid out (stopped or refunded jobs).
- Money is `numeric(10,2)` plus `currency text default 'EUR'`; the gateway boundary uses integer cents (`toCents`); the contract currency stays `z.literal('EUR')`. No Stripe objects in domain tables beyond opaque reference strings.
- Money rows are append-only: refunds and adjustments are new rows. Money columns on `bookings` and providers' Stripe columns are staff-only in RLS.
- Payout set-up is Stripe-hosted; Stripe collects identity, address, bank account and the DAC7 tax information; KANDO stores only the account id and when it became ready. Completion gives the verified mark. Without it a provider cannot send quotes or accept bookings; customers see "Notify me when available"; the provider is told the count only, no names.
- German and English for everything user-facing; no competitor names; no "Treuhand", "Escrow" or "Garantie" (use "payment protection" / "Zahlungsschutz", wording subject to the lawyer). Enums are `text` plus `check`. This plan's migration is `0015`. Every new table classified in `rls.ts` with an isolation test and added to `cleanupUsers()`. Owner merges; test report in `Reports/`; no AI co-author lines.

## Review Focus

- A payment that arrives after the booking expired or was withdrawn (customer paid in a tab left open): refunded in full automatically, booking not revived, customer told (Task 4 test `a late payment is refunded and the booking stays expired`).
- A webhook delivered twice, or the server crashing after Stripe acted but before the database commit: no second ledger row and no second transfer or refund (Task 4 `the same event twice is processed once`; Task 3 `settle twice writes the rows once`).
- A webhook with a missing or wrong signature: 400, nothing changes (Task 4).
- A booking far in the future: the money is held from payment to the job. If Stripe limits how long a platform may keep funds before transferring them, plan 2a's 365-day maximum ahead (`assertFuture`) must be lowered to fit; Task 2 records the limit found in the Stripe docs as a constant and the test `a booking further ahead than the hold limit cannot be paid` (400 `TOO_FAR_AHEAD`).
- Account deletion while a paid booking is still open: refused with 409 `OPEN_BOOKINGS` so money records and the other party are never orphaned (Task 3 test).

## File structure

- `packages/db/src/schema/payments.ts` (new): `ledger_entries`, `stripe_events`, `availability_watches`; modify plan 2a's `schema/bookings.ts`, `schema/providers.ts`, `schema/notifications.ts`, plan 2b's `schema/chat.ts` (flag kind). Migration `0015_payments.sql` (generated).
- `packages/db/src/rls.ts`: classify the new tables; staff-only money columns; triggers `bookings_fill_amount`, `bookings_guard_status`, `ledger_append_only`; constant `OWNER_ONLY_BOOKING_STATUSES`.
- `packages/contract/src/payments.ts` (new).
- `packages/domain/src/payments/rules.ts`, `gateway.ts`, `stripe-gateway.ts`, `ledger.ts`, `settle.ts`, `checkout.ts`, `webhook.ts`, `onboarding.ts`, `watches.ts` (new).
- Routes: `apps/web/app/app-api/v1/bookings/[id]/pay/route.ts`, `payouts/setup/route.ts`, `payouts/status/route.ts`, `providers/[slug]/notify-me/route.ts`, `apps/web/app/api/stripe/webhook/route.ts`; pages `apps/web/app/(site)/payment-done/page.tsx`, `payout-done/page.tsx`.
- Tests: `apps/web/tests/fake-gateway.ts`, `rls-payments.int.spec.ts`, `settle.int.spec.ts`, `payments.int.spec.ts`, `payouts.int.spec.ts`.
- Mobile: `apps/mobile/src/api/payments.ts` (+ test), changes to `booking-detail.tsx`, `provider-screen.tsx`, the service-profile screen.

### Task 1: Tables, staff-only money and the append-only ledger

**Files:** Create `packages/db/src/schema/payments.ts`, migration `0015_payments.sql`; modify the schema files listed above, `rls.ts`, `apps/web/tests/helpers.ts`; test `apps/web/tests/rls-payments.int.spec.ts`.

**Interfaces:**
- Changes to plan 2a's tables:
  - `bookings.status` check adds `confirmed`. New columns `commissionRate numeric(5,4)`, `paidAt`, `paymentRef` text, `checkoutRef` text, `releasedAt` (all nullable).
  - `providers`: `stripeAccountId` text (nullable, unique), `payoutsReadyAt` timestamptz (nullable).
- New tables:
  - `ledger_entries`: `id`, `bookingId` uuid (no foreign key: a deleted booking must not take money rows with it), `providerId` uuid (no foreign key), `kind` check `charge|refund|transfer|commission`, `amount numeric(10,2)` check `> 0`, `currency`, `gatewayRef` text, `idempotencyKey` text unique, `createdAt`. My call: single-entry rows with a kind (the sum per booking balances: charge = refund + transfer + commission once settled), not a double-entry journal.
  - `stripe_events`: `id` text primary key (the Stripe event id), `type`, `receivedAt`.
  - `availability_watches`: `customerId`, `providerId`, `createdAt`, `notifiedAt` (nullable); primary key `(customer_id, provider_id)`.
- `rls.ts`: `ledger_entries`, `stripe_events` in `STAFF_ONLY_TABLES`; `availability_watches` in `PRIVATE_TABLES` (`customer_id = app_current_user_id()`). `COLUMN_STAFF_ONLY.bookings = ['amount','currency','commission_rate','paid_at','payment_ref','checkout_ref','released_at']`; `COLUMN_STAFF_ONLY.providers` adds `stripe_account_id`, `payouts_ready_at`. Statements added to `rlsStatements()` (idempotent `CREATE OR REPLACE` + `DROP TRIGGER IF EXISTS`):
  - `bookings_fill_amount` BEFORE INSERT: sets `amount` and `currency` from the quote (`quote_id`) or else the service price (`service_id`); app requests can no longer supply them. **Changes plan 2a's** `acceptQuote` and `createDirectBooking`: drop `amount`/`currency` from their insert values.
  - `bookings_guard_status` BEFORE UPDATE: raises when `current_user = 'app_user'` sets `status` to one of `OWNER_ONLY_BOOKING_STATUSES` (exported constant, `['confirmed']` here; plan 2d appends). Those transitions run on the owner connection.
  - `ledger_append_only` BEFORE UPDATE OR DELETE: raises, unless `current_setting('kando.ledger_cleanup', true) = 'on'` (set only by `cleanupUsers()` inside its transaction).
- Notification kinds added: `booking-paid` (provider), `payment-received` (customer), `payment-late-refunded`, `payout-setup-complete`, `customers-waiting`, `provider-available`, `refund-issued`. `staff_flags.kind` adds `chargeback`.
- [ ] **Step 1: Write tests**: `app_user cannot read ledger_entries or stripe_events`, `app_user cannot set amount or payment_ref on a booking`, `a booking inserted without amount gets the quote's or the service's price`, `app_user cannot set status confirmed; the owner connection can`, `updating or deleting a ledger row fails, even on the owner connection`, `a customer sees only their own watches`; `db-migrations.int.spec.ts` passes.
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run tests/rls-payments.int.spec.ts tests/db-migrations.int.spec.ts`: FAIL.
- [ ] **Step 3: Implement**; `pnpm db:generate` for `0015`; adjust plan 2a's two inserts. **Step 4: Run** the Step 2 command plus plan 2a's `bookings.int.spec.ts` and `requests-quotes.int.spec.ts`: PASS.
- [ ] **Step 5: Commit** `feat(db): ledger, staff-only money columns and payout columns`.

### Task 2: Rules and the gateway interface

**Files:** Create `packages/domain/src/payments/rules.ts`, `gateway.ts`, `stripe-gateway.ts`, `apps/web/tests/fake-gateway.ts`; test `packages/domain/src/payments/rules.test.ts`.

**Interfaces:**
- Produces in `rules.ts`: `COMMISSION_RATE = 0.12` (comment: `PLACEHOLDER: the owner has not decided the rate (spec 4); README reminder`), `LIVE_PAYMENTS_ALLOWED = false`, `CUSTOMERS_WAITING_NOTICE_HOURS = 24` (my call), `MAX_HOLD_DAYS` (the Stripe limit for keeping funds before a transfer, found in the docs; `Infinity` only if Stripe states none), `paymentsEnabled(): boolean`, `toCents(amount: number): number`, `commissionFor(share: number, rate: number): number` (round half up to cents), `canTransact(p: { payoutsReadyAt: Date | null }): boolean` (`!paymentsEnabled() || p.payoutsReadyAt !== null`).
- Produces in `gateway.ts`:
  ```ts
  export interface PaymentsGateway {
    createAccount(i: { email: string; country: string }): Promise<{ accountId: string }>
    onboardingLink(i: { accountId: string; returnUrl: string; refreshUrl: string }): Promise<{ url: string }>
    accountReady(accountId: string): Promise<boolean>
    createCheckout(i: { bookingId: string; amountCents: number; currency: string; description: string; successUrl: string; cancelUrl: string; expiresAt: Date; idempotencyKey: string }): Promise<{ sessionId: string; url: string }>
    transfer(i: { accountId: string; amountCents: number; currency: string; paymentRef: string; bookingId: string; idempotencyKey: string }): Promise<{ transferId: string }>
    refund(i: { paymentRef: string; amountCents: number; idempotencyKey: string }): Promise<{ refundId: string }>
    verifyEvent(rawBody: string, signature: string): GatewayEvent // throws on a bad signature
  }
  export type GatewayEvent =
    | { id: string; type: 'checkout-paid'; bookingId: string; sessionId: string; paymentRef: string; amountCents: number; currency: string }
    | { id: string; type: 'account-updated'; accountId: string }
    | { id: string; type: 'charge-disputed'; paymentRef: string }
    | { id: string; type: 'other' }
  ```
  plus `gateway(): PaymentsGateway` (lazy Stripe instance; throws when `PAYMENTS_ENABLED` is off or the key is not a test key and `LIVE_PAYMENTS_ALLOWED` is false) and `setGatewayForTests(g: PaymentsGateway | undefined)`, following `storage()`/`setStorageForTests`.
- Stripe choice (spec 7a, the builder decides after reading the docs): **separate charges and transfers** is the expected fit (the charge stays in the platform balance; `transfer` uses `source_transaction` = the charge so it does not wait for the balance; `transfer_group` = booking id); choose destination charges with delayed payouts only if the docs show the hold period above is not supported otherwise. Record the decision and the hold limit in a comment at the top of `stripe-gateway.ts`. Connected account type: Stripe-hosted onboarding with the Express-style dashboard (current Accounts API controller properties per the docs); daily automatic payouts so funds reach the provider within 7 days of the release. Checkout sessions must expire within Stripe's allowed range: `expiresAt = min(payBy, now + 24h)`.
- `fake-gateway.ts`: `fakeGateway(): PaymentsGateway & { calls: { method: string; args: unknown }[]; ready: Set<string>; event(e: GatewayEvent): { body: string; signature: string } }`, idempotent by key like Stripe (same key, same result, recorded once); `verifyEvent` accepts only signatures it produced.
- [ ] **Step 1: Write tests**: `commissionFor(100, 0.12)` is `12`, `commissionFor(33.33, 0.12)` is `4` (3.9996 rounds to 4.00), `commissionFor(0.05, 0.12)` is `0.01`; `toCents(19.99)` is `1999`; `canTransact` is true for any provider when payments are off and false without `payoutsReadyAt` when on; `gateway() throws for an sk_live_ key`.
- [ ] **Step 2: Run** `pnpm --filter @kando/domain test`: FAIL. **Step 3: Implement**. **Step 4: Run**: PASS.
- [ ] **Step 5: Commit** `feat(domain): payments rules and gateway interface`.

### Task 3: Ledger and settlement

**Files:** Create `packages/domain/src/payments/ledger.ts`, `settle.ts`; modify `packages/domain/src/account.ts` (delete refusal); test `apps/web/tests/settle.int.spec.ts`.

**Interfaces:**
- Consumes: Task 1 tables, Task 2 `gateway()`, `toCents`, `commissionFor`.
- Produces: `addLedger(exec: Exec, row: { bookingId: string; providerId: string; kind: LedgerKind; amount: number; currency: string; gatewayRef: string; idempotencyKey: string }): Promise<void>` (insert, ignore an existing `idempotencyKey`); `paidAmount(exec, bookingId): Promise<number>` (charge minus refunds); `settle(exec: Exec, bookingId: string, providerShare: number): Promise<{ refunded: number; transferred: number; commission: number }>`.
- `settle` rules: requires `paid_at` set and `released_at` null (else 409 `ALREADY_SETTLED`); `0 <= providerShare <= paidAmount` (else 400); `commission = commissionFor(providerShare, booking.commissionRate)`; refund `paid - providerShare` when above 0; transfer `providerShare - commission` when above 0; ledger rows `refund`, `transfer`, `commission` with idempotency keys `refund:<bookingId>`, `transfer:<bookingId>`, `commission:<bookingId>` (the same keys go to the gateway); sets `released_at`. The caller sets the booking status (plan 2d). On a gateway error nothing is marked released and the error propagates, so a timer retries.
- Account deletion: refused with 409 `OPEN_BOOKINGS` while the person is customer or provider on a booking in `confirmed` (plan 2d extends the list with its open statuses).
- [ ] **Step 1: Write tests** (fake gateway): `settle full: one transfer of amount minus commission, one commission row, no refund`, `settle zero: one refund of the full amount, no commission`, `settle partial 40 of 100 at 0.12: refund 60, transfer 35.20, commission 4.80`, `settle twice writes the rows once` (second call 409, gateway called once per key), `a gateway failure leaves released_at null and no rows`, `the commission rate used is the booking's stored rate, not the current constant`, `deleting an account with a confirmed booking is 409 OPEN_BOOKINGS`.
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run tests/settle.int.spec.ts`: FAIL. **Step 3: Implement** (lock the booking row `FOR UPDATE` on the owner connection). **Step 4: Run**: PASS.
- [ ] **Step 5: Commit** `feat: append-only ledger and settlement`.

### Task 4: Pay link, webhook and confirmation

**Files:** Create `packages/contract/src/payments.ts`, `packages/domain/src/payments/checkout.ts`, `webhook.ts`; routes `bookings/[id]/pay/route.ts`, `apps/web/app/api/stripe/webhook/route.ts`; page `(site)/payment-done/page.tsx`; modify plan 2a's `bookings/busy.ts` and the `busy_times` function (count `confirmed` as `booked` and as blocking in `assertSlotFree`), `notify.ts`, `email.ts`, i18n; test `apps/web/tests/payments.int.spec.ts`.

**Interfaces:**
- Consumes: Task 2 gateway, Task 3 `addLedger`, `settle`; plan 2a's `payBy`, `notifyBookingEvent`; plan 2b's `flagForStaff`.
- Produces: `PayLinkSchema {url: string}`; `createPayLink(tx, userId, bookingId, now = new Date()): Promise<{ url: string }>` (customer only; status `awaiting-payment` and `now < payBy`, else 409; 400 `TOO_FAR_AHEAD` when the start is more than `MAX_HOLD_DAYS` away; idempotency key `checkout:<bookingId>:<payBy ISO>` so a second tap reuses the session; stores `checkoutRef`); `handleGatewayEvent(e: GatewayEvent, now = new Date()): Promise<void>`.
- `checkout-paid`: in one owner-connection transaction, insert the `stripe_events` row (conflict: return, already processed), lock the booking; if `awaiting-payment`: set `confirmed`, `paidAt`, `paymentRef`, `commissionRate = COMMISSION_RATE`, ledger `charge`; notify `payment-received` (customer) and `booking-paid` (provider). Otherwise: ledger `charge` then a full `refund` (key `refund:late:<bookingId>`), notify `payment-late-refunded`. `charge-disputed`: `flagForStaff({kind: 'chargeback', refId: bookingId})`. `account-updated`: Task 5.
- Webhook route: reads the raw body (`await request.text()`), `gateway().verifyEvent(body, request.headers.get('stripe-signature') ?? '')`, 400 on failure, 200 after `handleGatewayEvent`, 500 on an error (Stripe retries). Not wrapped in `appRequest` (no session); the success and cancel URLs point at `(site)/payment-done` which says, in German and English, that the payment is being confirmed and links back to the app.
- [ ] **Step 1: Write tests**: `the customer gets a pay link; the provider and a third user get 404`, `no pay link before acceptance or after payBy (409)`, `a second tap reuses the same session`, `a paid event confirms the booking, stores the commission rate and writes one charge row`, `the same event twice is processed once`, `a bad signature is 400 and changes nothing`, `a late payment is refunded and the booking stays expired`, `a confirmed booking blocks the time and shows as booked`, `with PAYMENTS_ENABLED off the pay route is 503 PAYMENTS_OFF`, `a booking further ahead than the hold limit cannot be paid`.
- [ ] **Step 2: Run**: FAIL. **Step 3: Implement**; email templates `payment-received`, `booking-paid`, `payment-late-refunded` (no "Treuhand", "Escrow" or "Garantie"; the customer text says the money is paid to the provider only when the work is done). **Step 4: Run**: PASS.
- [ ] **Step 5: Commit** `feat: pay link, verified webhooks and booking confirmation`.

### Task 5: Payout set-up, verified mark and "Notify me when available"

**Files:** Create `packages/domain/src/payments/onboarding.ts`, `watches.ts`; routes `payouts/setup/route.ts` (POST), `payouts/status/route.ts` (GET), `providers/[slug]/notify-me/route.ts` (POST, DELETE); page `(site)/payout-done/page.tsx`; modify `packages/domain/src/public-profile.ts` (`verified`, `canBook`), plan 2a's `createRequest`, `createDirectBooking`, `sendQuote`, `answerBooking`, `webhook.ts`, contract public provider schema, i18n; test `apps/web/tests/payouts.int.spec.ts`.

**Interfaces:**
- Consumes: Task 2 `gateway()`, `canTransact`; `ownProvider`; plan 2a's `notifyBookingEvent`.
- Produces: `startPayoutSetup(tx, userId): Promise<{ url: string }>` (own provider required, else 409 like `noProfile`; creates the Stripe account once with the provider's `country` and the user's email and stores `stripeAccountId` on the owner connection; returns a fresh onboarding link); `payoutStatus(tx, userId): Promise<{ ready: boolean }>` (asks `accountReady` and updates `payoutsReadyAt`, so the app is right even before the webhook); `refreshAccount(exec, accountId): Promise<void>` (used by `account-updated`; on the change to ready: notify `payout-setup-complete`, then every watcher with `notifiedAt` null gets `provider-available` and `notifiedAt` is set; on a change to not ready, clear `payoutsReadyAt`); `watchProvider(tx, userId, slug): Promise<void>` (then `customers-waiting` to the provider with `{count}`, at most once per `CUSTOMERS_WAITING_NOTICE_HOURS`, email, in-app and, after plan 2e, push), `unwatchProvider(tx, userId, slug)`.
- Public provider DTO adds `verified: boolean` (`payoutsReadyAt !== null`) and `canBook: boolean` (`canTransact`). **Changes to plan 2a's functions**: `createRequest` and `createDirectBooking` refuse with 409 `PROVIDER_NOT_READY` and `sendQuote` and a provider `accept` in `answerBooking` with 409 `PAYOUT_SETUP_FIRST` when `canTransact` is false.
- [ ] **Step 1: Write tests** (fake gateway, `PAYMENTS_ENABLED=true`): `set-up creates one account and returns a link; a second call reuses the account`, `status turns ready and the public profile shows verified`, `a provider without set-up cannot send a quote or accept (409); with set-up they can`, `a customer cannot request or book an unready provider (409) but can watch it`, `three watches send the provider one customers-waiting notice with count 3 within 24 hours`, `when the account becomes ready each watcher gets provider-available once`, `with payments off every provider can quote and verified is false`.
- [ ] **Step 2: Run**: FAIL. **Step 3: Implement**; i18n `payouts.*`, `provider.notifyMe`, `provider.verified`, emails `customers-waiting` (count only, no names), `provider-available`, `payout-setup-complete`. **Step 4: Run** the file and plan 2a's specs: PASS.
- [ ] **Step 5: Commit** `feat: payout set-up, verified mark and notify me`.

### Task 6: Mobile

**Files:** Create `apps/mobile/src/api/payments.ts` (+ `payments.test.ts`); modify plan 2a's `booking-detail.tsx` (the pay placeholder becomes "Pay now", opens the link with `WebBrowser.openBrowserAsync`, refetches on return), `provider-screen.tsx` (verified mark; "Notify me when available" replaces "Book" and "Request a quote" when `canBook` is false), the service-profile screen and the sign-up "I also want to offer services" and "Offer services" entries (a "Set up payouts" card that opens the onboarding link and shows the status), `apps/mobile/src/i18n/index.ts` (errors `PAYMENTS_OFF`, `PROVIDER_NOT_READY`, `PAYOUT_SETUP_FIRST`, `TOO_FAR_AHEAD`).

**Interfaces:**
- Produces: `payBooking(id: string): Promise<{ url: string }>`, `startPayoutSetup(): Promise<{ url: string }>`, `payoutStatus(): Promise<{ ready: boolean }>`, `notifyMe(slug: string)`, `stopNotifyMe(slug: string)`.
- [ ] **Step 1: Write `payments.test.ts`** asserting paths, methods and bodies. **Step 2: Run** `pnpm --filter mobile test`: FAIL. **Step 3: Implement**. **Step 4: Run** `pnpm --filter mobile test`, `npx tsc --noEmit`, `npx expo lint`: PASS.
- [ ] **Step 5: Commit** `feat(app): pay, payout set-up and notify me`.

### Task 7: Check, README and report

**Files:** Create `Reports/Stage-2c-Test-Report.xlsx`; modify `README.md`.
- [ ] **Step 1: Run** `pnpm typecheck && pnpm lint && pnpm test`; record counts. **Step 2: README**: "Payments are built but off (`PAYMENTS_ENABLED`), test mode only; real payments need the lawyer's points (section 'Legal points') and a code change of `LIVE_PAYMENTS_ALLOWED`"; reminder **"Decide the commission percentage: `COMMISSION_RATE` is a placeholder (12%) and must be set before payouts or the Preise page go live"**; environment variables `PAYMENTS_ENABLED`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`; the Stripe test-mode set-up steps for the owner (webhook endpoint URL and events). **Step 3: Phone-test rows** with Stripe test cards (successful card, declined card, 3-D Secure card). **Step 4: Commit** `docs: stage 2c report and README`. The owner merges.

## Self-review

- **Spec coverage:** 3.4 pay link after acceptance, confirmed when paid, full amount, failed charge leaves it unconfirmed: Task 4. 3.11 Stripe-hosted set-up, DAC7 by Stripe, verified mark, unfinished-provider rule, notify me with the count, "Now available": Task 5, 6. 4 Stripe holds, code instructs release, payout within 7 days, commission per booking at payment, append-only money rows, commission only on the amount paid out: Tasks 1 to 4. 7a hold mechanism left to the builder with the docs: Task 2. 9 and 9a off switch and test mode only: Global Constraints, Task 2, 7. Releases, cancellations, disputes, stop job and staff refunds are plan 2d (they call `settle`). Chargebacks: flagged to staff (Task 4); deducting from a later payout stays a staff action (foundation design).
- **Types:** plan 2a names unchanged (`bookings.status`, `payBy`, `answerBooking`, `notifyBookingEvent`, `assertSlotFree`, `busy_times`); plan 2b's `flagForStaff`, `StaffFlagKind` widened, not redefined. New names used by plans 2d and 2e: `settle`, `addLedger`, `paidAmount`, `LedgerKind`, `OWNER_ONLY_BOOKING_STATUSES`, `gateway`, `setGatewayForTests`, `fakeGateway`, `COMMISSION_RATE`, `canTransact`, `bookings.commission_rate`, `bookings.released_at`.
- **Proportion:** the gateway interface is spelled out because three plans and a fake depend on it; everything else is signatures, values and tests.
