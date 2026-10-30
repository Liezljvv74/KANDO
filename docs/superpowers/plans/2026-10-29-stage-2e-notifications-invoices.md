# Stage 2e: push notifications, invoices and the Stage 2 wrap-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every booking, chat and money event of plans 2a to 2d reaches the person by push (with two simple switches) and by email; every completed booking produces an invoice or receipt in the provider's name (several lines including additional tasks, labour and material split for section 35a EStG, wording for the provider's status, PDF, yearly export); KANDO sends each provider a monthly commission invoice with placeholders for the legal entity; Stage 2 ends with a README update and a test report.

**Architecture:** Push is one more channel inside plan 2a's `notifyBookingEvent`, sent through the Expo push service with plain `fetch` (an outbox in tests, like `email.ts`). Invoices are built by a pure function from the ledger and booking rows, numbered from a locked counter, stored as snapshots (so later profile changes never alter an issued invoice), rendered to PDF with `pdf-lib`, and stored in the private bucket. Issuing runs after each settlement and again in `runDueTimers` as the retry.

**Tech Stack:** existing stack; mobile adds `expo-notifications` and `expo-device` (with `npx expo install`; needs a development build); `packages/domain` adds `pdf-lib` (pure JavaScript, its standard Helvetica font covers German letters and the euro sign).

**Spec:** `docs/superpowers/specs/2026-10-29-stage-2-booking-and-money-design.md` (sections 3.10 push, 3.11 push to providers, 4 "Invoices and receipts, the monthly commission invoice", 5) and `docs/specs/2026-10-26-kando-foundation-design.md` (goal 4 "Paperwork included", section 8 numbering and PDF within section 14 UStG, section 19 wording and labour and material split; section 9 legal entity placeholders). Builds on plans 2a to 2d (`docs/superpowers/plans/2026-10-29-stage-2a-requests-quotes-bookings.md`, `-2b-chat.md`, `-2c-payments.md`, `-2d-finishing-disputes-reviews.md`). Read `apps/mobile/AGENTS.md` and the Expo SDK 58 push notification docs before Task 1.

## Global Constraints

- Every event of plans 2a to 2d has an in-app notification, an email and a push text, in German and English (email parity). Push switches (my call, kept minimal): "Chat messages" and "Reminders", both on by default; every other booking and money event is always pushed. Chat messages: push; email only when the recipient has no push token (still throttled by plan 2b's `CHAT_EMAIL_THROTTLE_MINUTES = 30`).
- An invoice or receipt per completed booking group (the root booking and its additional tasks), in the provider's name, issued by the platform on the provider's behalf; one line per booking with an amount paid out to the provider (the original, each additional task, a late-cancellation or no-show fee), with labour and material shown separately so the customer can claim section 35a EStG.
- Wording by the provider's `legalStatus`: `private` (private individual): a receipt, no VAT shown; `kleinunternehmer`: an invoice with DE "Gemäß § 19 UStG wird keine Umsatzsteuer berechnet." EN "No VAT is charged under section 19 UStG (small business rule)."; `business`: an invoice with net, VAT and gross per line at `VAT_RATES[country]` (`{ DE: 0.19 }`, one map; a missing country throws, known debt for the second market). A null `legalStatus` counts as `private`. All final wording is to be checked by a tax adviser (README).
- Amounts are gross (what the customer paid for that line). Material for a line = `round2(materialAmount * share / amount)`, labour = share minus material; fee lines have no labour or material split.
- Monthly commission invoice from the platform to each provider for the commission rows of the previous calendar month in `TIME_ZONE` (Europe/Berlin). The legal entity does not exist yet: name, address, register entry, VAT id and VAT wording are placeholders in one file (`PLATFORM_ENTITY`), with a README launch item. While `LIVE_PAYMENTS_ALLOWED` (plan 2c) is false, every PDF carries "TESTDOKUMENT / TEST DOCUMENT".
- Issued invoices are never changed or deleted, including on account deletion (legal retention; the privacy notice must say so, README item). Numbers are unique, per provider and year, without gaps: `<first 8 characters of the provider id, upper case>-<YYYY>-<0001>`; commission invoices `K-<YYYY>-<00001>`.
- Currency formatting through `formatMoney` from `@kando/i18n`; no "EUR" in labels; no new Germany-only assumptions beyond `VAT_RATES` and the German legal wording, both per country or per language. No competitor names; never "Treuhand", "Escrow" or "Garantie". The product name comes from the existing single setting, never typed into templates.
- Enums `text` plus `check`. Migrations `0019` (push, Task 1), `0020` (invoices, Task 4), `0021` (commission invoices, Task 6), each generated in its task. Every new table classified in `rls.ts` with an isolation test and in `cleanupUsers()`. Owner merges; report in `Reports/`; no AI co-author lines.

## Review Focus

- Two sweeps issuing the same booking group's invoice at the same moment: one invoice, one number, no gap (Task 4 test `concurrent issuing creates one invoice and no gap`).
- A group where one additional task was refunded and another paid out: the refunded one has no line; the totals equal the ledger (Task 4 test).
- A customer or provider deleting their account: their issued invoices stay (Task 4 test `account deletion keeps invoices`).
- A phone that changes hands (one person logs out, another logs in on the same device): the push token moves to the new person and the old one gets nothing more (Task 1 test).
- A commission row at 23:30 UTC on 31 January is February in Berlin and lands on February's commission invoice (Task 6 test).

## File structure

- `packages/db/src/schema/invoices.ts` (new): `invoices`, `commission_invoices`, `invoice_counters`; `packages/db/src/schema/push.ts` (new): `push_tokens`. Modify `schema/users.ts` (push switches), `schema/providers.ts` (`taxNumber`, `invoiceConsentAt`), `schema/notifications.ts`. Migrations `0019_push.sql`, `0020_invoices.sql`, `0021_commission_invoices.sql` (generated).
- `packages/domain/src/push.ts`, `packages/domain/src/invoices/{rules,entity,build,numbering,pdf,issue,commission,export}.ts` (new); modify plan 2a's `bookings/notify.ts`, plan 2b's `chat/messages.ts`, plan 2c's `canTransact`, plan 2d's `releaseBooking`, `cancel.ts`, `decideDispute`, plan 2a's `timers.ts`.
- Routes: `apps/web/app/app-api/v1/push-tokens/route.ts`, `me/push/route.ts`, `invoices/route.ts`, `invoices/[id]/pdf/route.ts`, `invoices/export/route.ts`, `commission-invoices/route.ts`, `commission-invoices/[id]/pdf/route.ts`.
- Mobile: `apps/mobile/src/api/push.ts`, `apps/mobile/src/api/invoices.ts` (+ tests), `apps/mobile/src/lib/push.ts`, screens for invoices and push settings.

### Task 1: Push tokens and switches

**Files:** Create `packages/db/src/schema/push.ts`, migration `0019_push.sql` (generated); modify `schema/users.ts`, `rls.ts`, `apps/web/tests/helpers.ts`; routes `push-tokens/route.ts` (POST, DELETE), `me/push/route.ts` (GET, PATCH); create `packages/domain/src/push.ts` (token part); mobile `apps/mobile/src/lib/push.ts`, `apps/mobile/src/api/push.ts` (+ test), settings row on the Account tab, `app.json` plugin entry; test `apps/web/tests/push-tokens.int.spec.ts`.

**Interfaces:**
- Tables: `push_tokens` (`id`, `userId`, `token` unique, `platform` check `ios|android`, `createdAt`, `lastSeenAt`), `PRIVATE_TABLES` with `user_id = app_current_user_id()`. `users` gains `pushChat boolean not null default true`, `pushReminders boolean not null default true` (writable by the user).
- Produces: `PushTokenInputSchema {token: string (starts with 'ExponentPushToken['), platform}`, `PushSettingsSchema {chat: boolean, reminders: boolean}`; `savePushToken(tx, userId, input): Promise<void>` (upsert by token: a token already held by another user moves to the caller; done on the owner connection after the caller is known, because the other user's row is invisible under RLS), `removePushToken(tx, userId, token)`, `getPushSettings`, `setPushSettings`. Mobile: `registerForPush(): Promise<void>` (after sign-in: ask permission, `getExpoPushTokenAsync` with the EAS project id, `savePushToken`; quietly does nothing on a simulator or when refused), `unregisterPush()` on sign-out.
- [ ] **Step 1: Write tests**: `a token is saved once and lastSeenAt updates on the second save`, `a token saved by a second user moves to them`, `a user cannot read another user's tokens`, `settings default to on and can be switched off`, mobile `push.test.ts` (paths, methods, bodies).
- [ ] **Step 2: Run** the spec and `pnpm --filter mobile test`: FAIL. **Step 3: Implement**; install with `npx expo install expo-notifications expo-device` in `apps/mobile`; add the plugin to `app.json`; README owner steps: Android FCM credentials and the Apple push key through EAS, then a new development build. **Step 4: Run**: PASS (plus `npx tsc --noEmit`, `npx expo lint`).
- [ ] **Step 5: Commit** `feat: push tokens and push switches`.

### Task 2: Sending push and email parity

**Files:** Modify `packages/domain/src/push.ts` (sending), plan 2a's `bookings/notify.ts`, plan 2b's `chat/messages.ts`, `email.ts`, `packages/i18n/src/en.ts`, `de.ts`; test `apps/web/tests/push-send.int.spec.ts` and `apps/web/tests/notification-parity.int.spec.ts`.

**Interfaces:**
- Consumes: plan 2a's `notifyBookingEvent(kind, userId, params)` and the notification kinds of plans 2a to 2d (the `notifications_kind_check` list is the single source; export it as `NOTIFICATION_KINDS` from `schema/notifications.ts` if it is not already exported).
- Produces: `sendPush(userId: string, message: { kind: NotificationKind; title: string; body: string; url: string }): Promise<void>` (never throws; loads the user's tokens and switches on the owner connection; `CHAT_PUSH_KINDS = ['message-received']`, `REMINDER_PUSH_KINDS = ['payment-reminder','quote-expiring','confirm-reminder']`; POST to `https://exp.host/--/api/v2/push/send` in chunks of 100 with `EXPO_ACCESS_TOKEN` when set; a ticket error `DeviceNotRegistered` deletes that token; under `VITEST` or `NODE_ENV=test` records into `pushOutboxForTests()` instead, with `clearPushOutbox()`); `notifyBookingEvent` now stores the in-app row, sends the email and calls `sendPush`, all after commit. Plan 2b's new-message email is sent only when the recipient has no push token.
- Texts: keys `push.<kind>.title` and `push.<kind>.body` for every kind; the push body never contains chat text or amounts beyond what the email shows; `url` is the app link to the booking, thread or invoice.
- [ ] **Step 1: Write tests**: `notification-parity`: for every kind in `NOTIFICATION_KINDS`, both languages have `notification.<kind>`, `push.<kind>.title`, `push.<kind>.body`, and `email.ts` has a template whose subject and body exist in both languages (fails today for kinds added without a template); `push-send`: `one event: one in-app row, one email, one push to each device`, `chat switch off: no push for messages, still for bookings`, `reminders switch off: no payment-reminder push`, `a message to a person with a token sends push and no email; without a token, an email`, `DeviceNotRegistered removes the token` (stub `fetch`).
- [ ] **Step 2: Run**: FAIL. **Step 3: Implement**; add the missing email templates and texts found by the parity test. **Step 4: Run** the two specs, `pnpm --filter @kando/i18n test`: PASS.
- [ ] **Step 5: Commit** `feat: push for every booking, chat and money event, with email parity`.

### Task 3: Invoice rules and building (pure)

**Files:** Create `packages/domain/src/invoices/rules.ts`, `entity.ts`, `build.ts`; test `packages/domain/src/invoices/build.test.ts`.

**Interfaces:**
- Produces: `VAT_RATES: Record<string, number>` (`{ DE: 0.19 }`); `S19_NOTE` per language (the exact texts in Global Constraints); `PLATFORM_ENTITY = { name: '[LEGAL NAME]', address: '[ADDRESS]', register: '[REGISTER ENTRY]', vatId: '[VAT ID]', vatNote: '[VAT WORDING: TAX ADVISER]' }` with the comment `PLACEHOLDER: the legal entity does not exist yet (foundation design section 9); README launch item`; types `InvoiceLine = { bookingId: string; kind: 'job' | 'additional-task' | 'late-cancel-fee' | 'no-show-fee'; description: string; serviceDate: string; labour: number; material: number; net: number; vat: number; gross: number }`, `InvoiceDraft = { kind: 'invoice' | 'receipt'; legalStatus: 'private' | 'kleinunternehmer' | 'business'; issuer: Party; recipient: Party; lines: InvoiceLine[]; totals: { net: number; vat: number; gross: number; labour: number; material: number }; currency: string; notes: string[] }`, `Party = { name: string; address: string | null; taxId: string | null }`; `buildInvoice(input: { provider: {...}; customer: {...}; bookings: { id; parentBookingId; status; amount; materialAmount; providerShare; startAt; title; cancelledBy; noShow }[]; country: string }): InvoiceDraft | null` (null when no booking has a share above 0); `invoiceLines(draft: InvoiceDraft, lang: Lang): string[]` (the text the PDF draws, in German with English labels in brackets, my call: one document for both people).
- Issuer: business or Kleinunternehmer: the business name, the Impressum text as the address, `vatId ?? taxNumber`; private: the account's full name and the base postcode and place. Recipient: the customer's full name and the job address (null for a remote booking). Notes: the section 19 wording, or none, plus "Ausgestellt im Namen und für Rechnung von <provider> durch <product name>" and a 35a line ("Arbeitskosten / labour: …, Material: …").
- [ ] **Step 1: Write tests**: `kleinunternehmer: invoice with the section 19 note and no VAT`, `business: 119.00 gross is 100.00 net and 19.00 VAT`, `private: a receipt, no VAT, no section 19 note`, `null legalStatus is treated as private`, `material 20 of 100 with a share of 50 gives material 10 and labour 40`, `a refunded additional task has no line; a paid one is its own line labelled as additional task`, `a late customer cancellation is a fee line with no labour or material`, `everything refunded returns null`, `an unknown country throws`.
- [ ] **Step 2: Run** `pnpm --filter @kando/domain test`: FAIL. **Step 3: Implement**. **Step 4: Run**: PASS.
- [ ] **Step 5: Commit** `feat(domain): invoice building with labour and material split`.

### Task 4: Issuing, numbering, PDF and download

**Files:** Create `packages/db/src/schema/invoices.ts` (migration `0020_invoices.sql`, which also adds the notification kind `invoice-ready`), `packages/domain/src/invoices/numbering.ts`, `pdf.ts`, `issue.ts`; routes `invoices/route.ts`, `invoices/[id]/pdf/route.ts`; modify `rls.ts`, `helpers.ts`, `schema/providers.ts`, plan 2c's `canTransact`, plan 2d's `releaseBooking`, `cancelBooking` timer path and `decideDispute` (each schedules `issueDueInvoices` after commit), plan 2a's `timers.ts` (`TimerReport.invoicesIssued`), the payout set-up card (tax number and the invoicing consent tick); test `apps/web/tests/invoices.int.spec.ts`.

**Interfaces:**
- Changes to existing tables: `providers.taxNumber` (text, nullable, provider-writable), `providers.invoiceConsentAt` (timestamptz, set when the provider ticks "The platform issues invoices in my name", consent text with a placeholder until the lawyer approves it). `canTransact` (plan 2c) additionally requires `invoiceConsentAt`, and for `kleinunternehmer` or `business` a `vatId` or `taxNumber`, when payments are enabled.
- Tables: `invoices` (`id`, `rootBookingId` unique, `providerId`, `customerId` (both plain ids, no foreign key, so account deletion keeps the invoice), `number` unique, `kind`, `issuedAt`, `currency`, `total`, `draft` jsonb (the `InvoiceDraft` snapshot), `fileKey` nullable); `invoice_counters` (`series` text primary key, `last` int). `invoices` in `PUBLISHED_READ_TABLES` (customer or provider owner); `invoice_counters` in `STAFF_ONLY_TABLES`.
- Produces: `nextNumber(exec, series: string): Promise<number>` (`INSERT ... ON CONFLICT (series) DO UPDATE SET last = invoice_counters.last + 1 RETURNING last`, in the same transaction as the invoice insert so a rollback leaves no gap); `issueDueInvoices(exec: Exec, now: Date): Promise<number>` (root bookings whose whole group is in a final status (`completed`, `cancelled`, `refunded`, `expired`, `declined`, `withdrawn`) and that have no invoice; builds with `buildInvoice` from the ledger (provider share = transfer plus commission), inserts, then renders and stores the PDF at `invoices/<providerId>/<number>.pdf` in `documentsBucket()`; a storage failure leaves `fileKey` null and the next run renders it; notifies `invoice-ready` to both); `renderPdf(draft: InvoiceDraft, number: string, issuedAt: Date, test: boolean): Promise<Uint8Array>` (`pdf-lib`, A4, Helvetica, the lines of `invoiceLines`, "TESTDOKUMENT / TEST DOCUMENT" when `test`); `listInvoices(tx, userId)`, `invoicePdfUrl(tx, userId, id): Promise<{ url: string }>` (signed for 600 seconds; 404 for anyone but the two parties).
- [ ] **Step 1: Write tests** (fake gateway, `memoryStorage()`): `a released booking gets one invoice with one line and a PDF that starts with %PDF-`, `a group with an open additional task waits; when the task is released the invoice has two lines`, `concurrent issuing creates one invoice and no gap` (two `issueDueInvoices` in `Promise.all`, numbers `…-0001` only, the next group gets `…-0002`), `numbers restart at 0001 in a new year`, `a storage failure leaves fileKey null and the next run fills it`, `both parties list and download it; a third user gets 404`, `account deletion keeps invoices`, `a Kleinunternehmer without tax number or VAT id cannot quote when payments are on (409 PAYOUT_SETUP_FIRST)`.
- [ ] **Step 2: Run**: FAIL. **Step 3: Implement**; add `pdf-lib` to `packages/domain`. **Step 4: Run**: PASS.
- [ ] **Step 5: Commit** `feat: invoices and receipts with numbering and PDFs`.

### Task 5: Yearly export

**Files:** Create `packages/domain/src/invoices/export.ts`; route `invoices/export/route.ts`; test `apps/web/tests/invoice-export.int.spec.ts`.

**Interfaces:**
- Produces: `exportInvoices(tx, userId, year: number): Promise<string>` (the provider's issued invoices of that calendar year in `TIME_ZONE`: CSV with a byte order mark like the existing account export, columns `number, date, customer, labour, material, net, vat, gross, currency, kind`; a year outside 2020 to next year is 400).
- [ ] **Step 1: Write tests**: `the provider gets this year's invoices only, totals match the PDFs`, `a customer gets an empty export`, `year=abc is 400`. **Step 2: Run**: FAIL. **Step 3: Implement**. **Step 4: Run**: PASS.
- [ ] **Step 5: Commit** `feat: yearly invoice export`.

### Task 6: Monthly commission invoice

**Files:** Create `packages/domain/src/invoices/commission.ts`; routes `commission-invoices/route.ts`, `commission-invoices/[id]/pdf/route.ts`; modify the invoices schema (migration `0021_commission_invoices.sql`, which also adds the notification kind `commission-invoice-ready`; `commission_invoices`: `id`, `providerId` (no foreign key), `month` text `YYYY-MM`, `number` unique, `total`, `currency`, `issuedAt`, `fileKey`; unique `(provider_id, month)`; `PUBLISHED_READ_TABLES`, provider owner), `rls.ts`, plan 2a's `timers.ts` (`TimerReport.commissionInvoices`); test `apps/web/tests/commission-invoices.int.spec.ts`.

**Interfaces:**
- Produces: `issueCommissionInvoices(exec: Exec, now: Date): Promise<number>` (for the previous month in `TIME_ZONE`, every provider with `commission` ledger rows in it and no invoice for it: one invoice, series `commission:<YYYY>`, issuer `PLATFORM_ENTITY`, recipient the provider as on their invoices, one line per booking with the commission, VAT wording `PLATFORM_ENTITY.vatNote`; PDF as in Task 4; notifies `commission-invoice-ready`); runs from `runDueTimers` (idempotent: the unique key makes a second run do nothing).
- [ ] **Step 1: Write tests**: `two commissions in January give one January invoice with their sum`, `a commission at 23:30 UTC on 31 January is on February's invoice`, `a second run creates nothing`, `a month without commission creates nothing`, `only the provider can download it`. **Step 2: Run**: FAIL. **Step 3: Implement**. **Step 4: Run**: PASS.
- [ ] **Step 5: Commit** `feat: monthly commission invoices with placeholder entity details`.

### Task 7: Mobile invoices

**Files:** Create `apps/mobile/src/api/invoices.ts` (+ test), `apps/mobile/src/screens/invoices/{invoice-list,commission-list}.tsx`, routes under `apps/mobile/src/app/invoices/`; modify `booking-detail.tsx` (an "Invoice" or "Receipt" row once issued), the Account tab (invoices, commission invoices and the yearly export for providers, shared with the existing share-sheet approach).

**Interfaces:**
- Produces: `listInvoices()`, `invoicePdf(id): Promise<{ url: string }>` (opened with `WebBrowser.openBrowserAsync`), `exportInvoices(year): Promise<string>`, `listCommissionInvoices()`, `commissionInvoicePdf(id)`.
- [ ] **Step 1: Write the API tests**. **Step 2: Run** `pnpm --filter mobile test`: FAIL. **Step 3: Implement**. **Step 4: Run** `pnpm --filter mobile test`, `npx tsc --noEmit`, `npx expo lint`: PASS.
- [ ] **Step 5: Commit** `feat(app): invoices, commission invoices and export`.

### Task 8: Stage 2 README and test report

**Files:** Create `Reports/Stage-2-Test-Report.xlsx` (sheets: tests per plan 2a to 2e with counts, other checks, phone-test checklist for the whole booking journey, open items); modify `README.md`.
- [ ] **Step 1: Run** `pnpm typecheck && pnpm lint && pnpm test`; record the counts per package.
- [ ] **Step 2: Phone-test checklist** (one row each, "Not yet done" until the owner tests): request with photos, quote, chat with a blocked phone number, accept and agree a time, pay with a Stripe test card, Finished, confirm, review both ways, additional task, cancel early and late, dispute decided in the back office, stop job, push received with the app closed, invoice PDF opened, commission invoice, yearly export.
- [ ] **Step 3: README**: "What the app does today" for Stage 2; "Not built" (AI chat check, numbers in photos, in-app calling, deposits, recurring bookings, public holidays in the 14 working days, refunds after release outside the Stripe dashboard); owner decisions still open (**commission percentage**, legal entity details for `PLATFORM_ENTITY`, the lawyer's points in "Legal points to clear with a lawyer", the tax adviser's check of invoice wording and the invoicing consent text, the EU AI provider, the privacy notice line on keeping invoices after account deletion); owner set-up steps (Stripe test webhook, `PAYMENTS_ENABLED`, push credentials and a new development build); START HERE updated.
- [ ] **Step 4: Commit** `docs: Stage 2 README and test report`. The owner merges.

## Self-review

- **Spec coverage:** push for every event and email otherwise (3.10, 3.11 count notice): Tasks 1, 2. Invoices and receipts in the provider's name with labour and material and status wording, several lines per booking including additional tasks, PDF, yearly export (spec 4, foundation goal 4): Tasks 3 to 5, 7. Monthly commission invoice with placeholders for the missing legal entity (foundation section 9): Task 6. README and test report for Stage 2 (spec 5): Task 8. DAC7 data is Stripe's (plan 2c); nothing is collected here.
- **Types:** plan 2a's `notifyBookingEvent`, `runDueTimers`, `TimerReport`; plan 2b's message notice and `CHAT_EMAIL_THROTTLE_MINUTES`; plan 2c's `canTransact`, `LIVE_PAYMENTS_ALLOWED`, ledger kinds `transfer` and `commission`, `bookings.commission_rate`; plan 2d's `releaseBooking`, `cancelBooking`, `decideDispute`, `materialAmount`, `parentBookingId`, statuses `completed|cancelled|refunded`, `cancelledBy`, `noShow` are used as those plans define them. New kinds `invoice-ready` (`0020`) and `commission-invoice-ready` (`0021`) are added to the notification check, and the parity test of Task 2 then covers them.
- **Proportion:** eight tasks; the invoice draft type is spelled out because the PDF, the export and the tests all read it; everything else is signatures, values and tests.
