# Flow 1: one request-to-booked flow with a quote document Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** DRAFT, written 1 November 2026 from the owner's process description and the three decisions confirmed the same day. Nothing in this plan is built yet. The owner confirms this plan before Task 1 starts.

**Goal:** Every job starts the same way: the customer sends one request that already holds the date, time, duration, place and description. The provider sees the same fields prefilled and answers with one tap: **Accept and send quote**, **Propose a different time** or **Reject**. The quote (start, duration, total) is generated as a numbered PDF the moment the provider sends it, saved for both people and downloadable. The customer answers with one tap: **Confirm and pay**, **Open chat** or **Decline**. After one proposal in each direction the app steers both to the chat. The job is booked when the customer's payment goes through.

**The owner's process (source of truth, 1 November 2026):**
1. Customer sends a request or books a service; all information including the requested date and time goes to the provider.
2. The provider's fields are filled in with what the customer sent.
3. The provider can: (a) accept everything as requested (only after the price is filled in) - request status Accepted; (b) reject - Rejected; (c) propose another time and/or ask for more detail - Pending.
4. If the provider accepted the time and sent a quote, the customer can accept, reject or open the chat. If the provider rejected, the customer is invited to contact another provider and the interaction ends. If the provider proposed a different time, the customer can accept or reject.
5. After a rejection once in each direction the app proposes the chat. The agreed time is entered by either party and sent to the other for confirmation.
6. A quote is generated and sent after the price and time were accepted on screen: start time, duration and total cost; saved on the account page (provider: "Quotes sent", customer: "My received quotes"); can be downloaded and printed. Each side confirms once.

**Decisions confirmed by the owner (1 November 2026):**
1. One merged flow: "request a quote" and "book a fixed-price service" become the same thing. The customer always sends a request with a time.
2. The provider's **Accept and send quote** is the provider's only confirmation; the customer's **Confirm and pay** is the customer's only confirmation, and it opens payment directly. The booking is **Booked** when the payment goes through (the existing paid state, `confirmed`).
3. The quote PDF is built on the invoice code (`packages/domain/src/invoices`), kept as unchangeable numbered versions.
5. (Added 1 November 2026) The provider's quote may be **with or without a final date and time**. A quote without one says "date and time to be confirmed". The customer can accept it anyway; the date and time are then confirmed afterwards, in the chat, by both sides (Task 6a). **Recommended default, to be confirmed by the owner:** no payment is asked until the time is agreed (see Open points 4).
4. A customer's **Reject** of a provider's different time sends both to the chat first; **Decline** ends the interaction, but offers the chat first ("Do you want to talk to the provider first?": **Open chat** or **Decline anyway**).

**Architecture:** Keep the existing tables and the existing money and ending rules; change only how a booking comes to exist.
- A **request** now carries the proposed time (`start_at`, `duration_min`, `on_site`, address, note) and a `revision` counter.
- A **quote** is the provider's answer. It already has `version`, `amount`, `start_at`, `duration_min`, `status` and `expires_at`; it gains an official `number`, the place, and `file_key` (the PDF). A different time is simply the next quote version with another `start_at`.
- A **booking** is created only when the customer confirms, directly in `awaiting-payment` (with `pay_by` from the existing `payBy()` rule), and the existing payment, finishing, dispute and invoice code takes over unchanged. The old `proposed` booking state and its counter-proposal loop are retired for new jobs (Task 12); old rows stay valid.
- A **quote without a time** (`quotes.start_at` is null: the column is already nullable) is accepted by the customer into a new booking status `awaiting-time`: no slot held, no payment window, no money. The booking row keeps the customer's requested time as a **provisional** `start_at` (the column stays not null, so no other code changes) until both sides agree the real one; then the booking moves to `awaiting-payment` with `pay_by` from the confirmed time. An `awaiting-time` booking that is not settled within 7 days expires (timers).
- One function, `timeIsAcceptable`, decides whether a time can be offered or confirmed. Today it is "in the future, on site/remote allowed, no clash with a held slot". Flow 2 (availability) later adds opening hours and notice rules inside this one function without touching the flow.

**Tech Stack:** existing: Drizzle + Postgres RLS (`packages/db`), zod contract (`packages/contract`), domain modules (`packages/domain`), Next.js route handlers (`apps/web/app/app-api/v1`), `pdf-lib` PDFs and the documents bucket (`packages/domain/src/invoices/pdf.ts`, `storage.ts`), Expo app (`apps/mobile`), vitest integration tests, jest for mobile. No new dependency.

**Read first:** `apps/web/AGENTS.md`, `apps/mobile/AGENTS.md`, `docs/superpowers/plans/2026-10-29-stage-2a-requests-quotes-bookings.md` (the model this plan changes) and `packages/domain/src/bookings/{requests,bookings,rules,notify,busy}.ts`.

## Global Constraints

- Everything user-facing exists in German and English (`packages/i18n/src/en.ts` and `de.ts` same keys, `en-server.ts` and `de-server.ts` for emails; `packages/i18n/src/index.test.ts` enforces parity). No competitor names. No "Treuhand", "Escrow" or "Garantie".
- Money stays `numeric(10,2)` + `currency`; contract currency `z.literal('EUR')`. No new Germany-only assumptions (South Africa is a later market).
- Every new column on a classified table needs no new RLS map entry, but each new read path gets an isolation test (a third user reads no quote and no PDF link).
- Migrations continue from `0023` (next is `0024`). Enums are `text` + `check(...)`.
- Errors shown to people use the existing friendly-error pattern (`errorText(code)`; a new server error code gets its sentence in German and English and the steps to fix it).
- Timing values stay in `packages/domain/src/bookings/rules.ts`: provider answers within 3 days (`REQUEST_ANSWER_DAYS`), a quote is valid 7 days (`QUOTE_VALID_DAYS`) but never past its start time, payment window by `payBy()`. New constant: `PROPOSALS_BEFORE_CHAT = 1` (one proposal each way, then chat).
- Repo rules: tests per task are only the affected specs plus `tsc`; the full suites run once at the end (Task 13); no AI co-author or "Generated with" lines; the owner merges every PR; the test report goes in `Reports/`; the README gets the stage description after the stage (Task 13).
- The date and time fields in the app are still typed text (phone-test Finding 2, deferred). This plan reuses the shared `TimeProposalForm`, so the later date/time picker change is made once in that form and applies everywhere here.

## Review Focus

- A booking can no longer be created without the customer's confirm tap and a payable time; two customers confirming the same time: exactly one wins, the other gets 409 `slot-pending` with a plain sentence.
- A quote is unchangeable: its PDF, number, total and time never change after sending; a new price or time is a new version with the next number, and the old version shows as replaced.
- Numbers are gapless per provider and year (same counter table as invoices, a separate series); a failed PDF write never loses the quote (the sweep retries, as for invoices).
- The party rule: a third user can neither read a quote nor get a PDF link (404); a provider can never confirm for the customer, a customer can never send a quote.
- The round rule is enforced on the server, not only by hiding buttons: a second proposal in the same direction without chat contact between is refused with a sentence that points to the chat.
- Rejected provider: the request ends, nothing is held, the customer sees "find another provider".
- A booking in `awaiting-time` never holds a slot and never asks for money; the time written at confirm is checked again under the lock.
- Old data: bookings already in `proposed` still work (answer, expire) until they end.
- Nothing here changes the payment, payout, commission, invoice or ending logic.

## File structure

- `packages/db/src/schema/bookings.ts`: new columns on `requests` and `quotes`; `packages/db/migrations/0024_*.sql` (generated) and `0025_notification_kinds.sql` (hand-written check widening).
- `packages/contract/src/bookings.ts`, `me.ts`: schemas and the two new notification kinds.
- `packages/domain/src/bookings/rules.ts` (add `timeIsAcceptable`, `mayPropose`), `requests.ts` (request with time, revise, send quote), `bookings.ts` (retire counter for new jobs), new `confirm.ts` (customer confirm), `notify.ts`.
- `packages/domain/src/quotes/{pdf,issue,list}.ts` (new): quote PDF, numbering and storage, lists and signed link.
- `apps/web/app/app-api/v1/{requests,quotes,bookings}/**/route.ts`: changed and new routes.
- `apps/mobile/src/screens/bookings/*`, `apps/mobile/src/screens/quotes/*` (new), `apps/mobile/src/app/quotes/*` (new), `apps/mobile/src/screens/account-screen.tsx`, `apps/mobile/src/api/{bookings,quotes}.ts`.
- `Reports/`, `README.md`.

### Task 1: Database - the request carries the time, the quote carries a number and a PDF

**Files:** modify `packages/db/src/schema/{bookings,invoices}.ts`, `packages/db/src/rls.ts`, `packages/contract/src/bookings.ts` (`awaiting-time` in `BOOKING_STATUSES`), `packages/domain/src/bookings/rules.ts` (`TRANSITIONS`), `packages/domain/src/admin/bookings.ts`, the German and English `bookingStatus.awaiting-time` text, `apps/web/tests/helpers.ts` (`cleanupUsers`); create `packages/db/migrations/0024_*.sql` (generated); test `apps/web/tests/rls-bookings.int.spec.ts` (extend).

**Interfaces:**
- `requests` adds: `start_at` timestamptz (nullable: old rows), `duration_min` int, `on_site` boolean, `address_street`, `address_postcode`, `address_city` (nullable), `note` text, `revision` int not null default 0.
- `quotes` is **not changed** (its `start_at` and `duration_min` are already nullable). The number, the PDF key and the snapshot go in a new table `quote_documents` (`quote_id` unique, `provider_id`, `customer_id`, `number` unique per provider, `issued_at`, `draft` jsonb, `file_key` nullable), classified like `invoices` (read by the two parties, written on the owner connection, plain ids, no foreign keys). Whether a quote proposes a different time is derived by comparing its `start_at` with the request's, not stored.
- `bookings.status` check gains `awaiting-time` (also in `BOOKING_STATUSES` and `TRANSITIONS`: `awaiting-time` to `awaiting-payment`, `expired`, `withdrawn`; it is not in `SLOT_HOLDING_STATUSES`); `bookings.time_proposed_by` text null (`'provider'|'customer'`), `time_proposed_start_at`, `time_proposed_duration_min`, `time_proposed_on_site` and `time_answer_by` timestamptz null for the agree-the-time step.
- Notification kinds added in Task 9 (with their texts, so every list that must agree changes together): `time-proposed` (provider proposed a different time), `request-updated` (customer changed the request's time), `time-to-confirm` (the other side entered the agreed time: please confirm it). Migration `0025` widens the notice check there.
- **Built in Task 1 (done):** migration `0024_quiet_daimon_hellstrom.sql`; `rls.ts`: `quote_documents` in `PUBLISHED_READ_TABLES` (party read), move `awaiting-time>withdrawn` by the customer, the five `time_*` columns staff-only, the quote-reopen trigger also fires from `awaiting-time`; `bookingAppInsert` is unchanged.

- [ ] **Step 1: Write the failing tests** in `rls-bookings.int.spec.ts` (add: a booking can be stored as `awaiting-time` and does not appear in `busy_times`): `a third user cannot read a quote number or file key`, `the customer and the provider owner can read the quote's time and place`, `app_user cannot set a quote's number or file_key` (issuing is an owner-connection step, like invoices).
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run tests/rls-bookings.int.spec.ts tests/db-migrations.int.spec.ts`: expect failure.
- [ ] **Step 3: Implement** the columns in the schema, `pnpm db:generate` for `0024`, hand-write `0025` (widen `notifications_kind_check`, copy the latest list from `0023` and add the two kinds), add a trigger or grant so `number`/`file_key` are writable only on the owner connection (follow `OWNER_ONLY_BOOKING_STATUSES` in `rls.ts`).
- [ ] **Step 4: Run** the Step 2 command: expect pass. Also `pnpm --filter @kando/db exec tsc --noEmit`.
- [ ] **Step 5: Commit** `feat(db): requests carry a time, quotes carry a number and a PDF key`.

### Task 2: Contract

**Files:** modify `packages/contract/src/bookings.ts`, `me.ts`; test `bookings.test.ts`, `me.test.ts`.

- [ ] **Step 1: Write failing tests**: `RequestInputSchema` accepts a request with `startAt`, `durationMin`, `onSite` (address required when on site, reuse `TimeProposalSchema`) and rejects one without a time; `SendQuoteInput` is `{ amount, scope?, startAt, durationMin }`; `QuoteListItemSchema` (`id`, `number`, `role`, `requestId`, `startAt`, `durationMin`, `amount`, `currency`, `counterparty`, `status`, `issuedAt`, `pdfReady`); the notification kinds list contains the two new kinds.
- [ ] **Step 2: Run** `pnpm --filter @kando/contract test`: expect failure.
- [ ] **Step 3: Implement.** `RequestInputSchema` becomes `z.intersection(TimeProposalSchema, z.object({ providerId, serviceId?, description }))`; keep `preferredDate` optional and ignored for old clients for one release. Add the answers as a discriminated union on `type`: `'send-quote' | 'reject'` for the provider, `'confirm' | 'decline'` for the customer. `PROPOSALS_BEFORE_CHAT` lives in the domain only, not in the contract.
- [ ] **Step 4: Run** the tests: pass. Run `pnpm --filter @kando/contract exec tsc --noEmit` and the mobile and web `tsc` (types flow outward).
- [ ] **Step 5: Commit** `feat(contract): request with a time, quote answers, quote list`.

### Task 3: One rule for "is this time acceptable", and the round rule

**Files:** modify `packages/domain/src/bookings/rules.ts`, `busy.ts`; test `packages/domain/src/bookings/rules.test.ts`.

**Interfaces:**
- `timeIsAcceptable(tx, { providerId, startAt, durationMin, onSite, now, ignoreBookingId? })` throws the existing 400/409 errors (`start-in-past`, `start-too-far`, `on-site-required`, `slot-pending`). It is the only caller of `assertFuture` and `assertSlotFree` for new flows. Flow 2 extends it.
- `mayPropose({ proposalsByCustomer, proposalsByProvider, chatContactSinceLast })`: returns `{ ok: true }` or `{ ok: false, reason: 'chat-first' }`. With `PROPOSALS_BEFORE_CHAT = 1` a side that already made one proposal needs chat contact from the other side since then.

- [ ] **Step 1: Write failing tests** for both, covering: past, too far, remote when the provider does not work remotely, clash with an awaiting-payment booking, clash with the 30-minute on-site buffer, touching spans free; round rule: first proposal each way free, a repeat without chat refused, a repeat after a chat message from the other side allowed.
- [ ] **Step 2: Run** `pnpm --filter @kando/domain test -- rules`: expect failure.
- [ ] **Step 3: Implement** by moving the existing checks behind the one function; do not duplicate them.
- [ ] **Step 4: Run** the Step 2 command: pass. `tsc` for domain.
- [ ] **Step 5: Commit** `feat(domain): one time check and the proposal round rule`.

### Task 4: Customer sends and revises a request that carries the time

**Files:** modify `packages/domain/src/bookings/requests.ts`; test `apps/web/tests/requests.int.spec.ts` (extend or create `request-time.int.spec.ts`).

- [ ] **Step 1: Write failing integration tests**: a customer request stores the time, place and note and notifies the provider (`request-received`); a request for an unpublished or suspended provider is 404; own service 400; a past time 400; with a fixed-price service the response includes `suggestedAmount` (the service price) for the provider's prefill; `reviseRequest` (customer changes the time of an open or quoted request) bumps `revision`, supersedes the sent quote, notifies the provider with `request-updated`, and is refused by the round rule with `chat-first`.
- [ ] **Step 2: Run** the new spec: expect failure.
- [ ] **Step 3: Implement** `createRequest` with the time fields (reuse `timeIsAcceptable` with `ignore` not needed: a request holds no slot), and `reviseRequest`. The existing limits stay (`MAX_OPEN_REQUESTS_PER_PAIR`, `MAX_REQUESTS_PER_DAY`).
- [ ] **Step 4: Run** the spec: pass.
- [ ] **Step 5: Commit** `feat(domain): a request carries the customer's time and can be revised`.

### Task 5: Provider answers: accept and send quote, propose a different time, reject

**Files:** modify `packages/domain/src/bookings/requests.ts` (`sendQuote` already exists: extend it), `notify.ts`; test `apps/web/tests/quote-send.int.spec.ts`.

- [ ] **Step 1: Write failing tests**: `send-quote` with the request's time and a price creates version 1 (a quote **without** a time is allowed: `startAt` omitted means "to be confirmed", no clash check is run for it, `proposed_other_time = false`, same `quote-received` notice), `proposed_other_time = false`, notice `quote-received` to the customer; with another time creates the next version with `proposed_other_time = true`, notice `time-proposed`, and supersedes the old one; a price of zero or missing is 400 (the Accept button is only enabled after a price, the server enforces it too); the provider cannot send a quote to a request that is not theirs (404) or closed (409); `reject` closes the request as `declined` and sends `request-declined` (existing); the round rule applies to the provider's second different time.
- [ ] **Step 2: Run** the spec: expect failure.
- [ ] **Step 3: Implement.** `timeIsAcceptable` runs at send time (the quote does not hold the slot, but a time already taken must not be offered). `expiresAt` = the earlier of `now + QUOTE_VALID_DAYS` and the start time. The quote copies place and address from the request (snapshot). Number and PDF are added by Task 7 in the same transaction commit sequence (the quote exists first, the PDF is stored after commit with a retry sweep, as invoices do).
- [ ] **Step 4: Run** the spec: pass.
- [ ] **Step 5: Commit** `feat(domain): provider sends a quote, proposes another time or rejects`.

### Task 6: Customer confirms (and pays), declines, or goes to the chat

**Important (found in Task 1):** the app role may only insert a booking as `proposed` (`INSERT_RULES` in `rls.ts`), and `awaiting-payment` is reached only by an update with guards. So `confirmQuote` writes the booking on the **owner connection after the domain checked the caller**, exactly as `acceptAdditional` does for additional tasks; no row-level-security rule is loosened.

**Files:** create `packages/domain/src/bookings/confirm.ts`; modify `bookings.ts` (stop creating `proposed` bookings from quotes); test `apps/web/tests/quote-confirm.int.spec.ts`.

- [ ] **Step 1: Write failing tests**: `confirmQuote` by the request's customer creates the booking directly in `awaiting-payment` with `pay_by` from `payBy()`, `source = 'quote'`, `amount` from the quote, the quote `accepted`, the request `booked`; a second confirm of the same quote is 409 (`quote-not-open`); two customers confirming overlapping times: one wins, the other 409 `slot-pending`; an expired or superseded quote is 409 with its own code; a stranger is 404; the provider cannot confirm (403 `not-your-turn`); a customer `decline` closes the request with the existing status `withdrawn` and tells the provider with `request-withdrawn`; chat card `acceptance` is posted; the provider is told with `booking-accepted`-style notice that the customer confirmed (reuse `booking-paid` later at payment: no new kind).
- [ ] **Step 2: Run** the spec: expect failure.
- [ ] **Step 3: Implement** with `lockProviderSlots` first, `timeIsAcceptable` again under the lock (the quote did not hold the slot), then insert the booking. Reuse the existing `acceptAdditional` untouched for additional tasks (their quotes keep their own flow).
- [ ] **Step 4: Run** the spec: pass; also run the existing `bookings` specs that touch `acceptQuote` and update them to the new name.
- [ ] **Step 5: Commit** `feat(domain): the customer's confirm creates the booking awaiting payment`.

### Task 6a: Agree the date and time afterwards (quote accepted without a time)

**Files:** modify `packages/domain/src/bookings/{confirm,rules,timers}.ts`, `notify.ts` (the Task 1 columns are already there); test `apps/web/tests/booking-time-agree.int.spec.ts`.

- `confirmQuote` on a quote without a time creates the booking in `awaiting-time` (provisional `start_at` from the request, `pay_by` null, no slot lock) and tells the provider. Either side then calls `proposeAgreedTime` (date, time, duration, place), which runs `timeIsAcceptable`, stores it as the pending time (`time_proposed_by`, `time_answer_by = now + 48 h`) and sends `time-to-confirm` to the other side. The other side calls `confirmAgreedTime`: under the provider slot lock it runs `timeIsAcceptable` again, writes the time, sets `awaiting-payment` with `pay_by` from `payBy()`, and tells the customer to pay (`booking-accepted`).
- Entering a time is allowed any time after the booking exists, with no round limit (the chat is where it is agreed). A pending time not confirmed within 48 hours falls away (the booking stays `awaiting-time`); the booking itself expires 7 days after the quote was confirmed (`AWAITING_TIME_DAYS = 7`, one constant in `rules.ts`); the cron run is idempotent like the other timers.
- The customer can withdraw (existing `withdrawBooking`, allowed from `awaiting-time`); the provider can decline.

- [ ] **Step 1: Write failing tests**: confirm of a time-less quote gives `awaiting-time` with no `pay_by` and no busy time; propose and confirm by the other side gives `awaiting-payment` with the right `pay_by`; the proposer cannot confirm their own time (403); two people confirming at once: one wins; a taken or past time is refused at confirm (409 `slot-pending` / 400); expiry after 7 days is idempotent; withdraw works; a third user is 404.
- [ ] **Step 2: Run** the spec: expect failure.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the spec: pass; `tsc`.
- [ ] **Step 5: Commit** `feat(domain): the date and time can be agreed after the quote is accepted`.

### Task 7: The quote document (number, PDF, lists, download link)

**Files:** create `packages/domain/src/quotes/{pdf,issue,list}.ts`; modify `packages/domain/src/index.ts`; reuse `invoices/{pdf,numbering}.ts` helpers (`pdfSafe`, wrap, `nextNumber`, `formatNumber`, `isTestNumber`, the test watermark); tests `packages/domain/src/quotes/pdf.test.ts`, `apps/web/tests/quote-document.int.spec.ts`.

**Interfaces:**
- Number: `Q-<first 8 of provider id>-<year>-0001`, own series (`<providerId>-<year>-quote[-test]`) so invoice numbers stay gapless.
- PDF content: issuer (provider name and business details as invoices print them: use `invoiceProvider()`), customer name, job place, start (date and time in `TIME_ZONE`, or "date and time to be confirmed" for a quote without one), duration, scope text, total (gross as the provider's price, with the VAT line only when `invoiceProvider` says the provider charges VAT, same rule as invoices), quote number and version, valid until, and the line "Quote - not an invoice". The PDF is stored once, so it is printed in one language: the provider's language (German by default). The README says so.
- `issueQuoteDocument(quoteId)`: owner connection; takes the number from `invoice_counters` (series `<providerId>-<year>-quote[-test]`) in the same transaction as the `quote_documents` insert (no gap; the draft snapshot is stored there), renders, stores under `quotes/<providerId>/<number>.pdf` in the documents bucket, writes `file_key`; a storage failure leaves `file_key` null and the sweep (add to the existing invoicing sweep or the bookings cron) retries; never throws.
- `listQuotes(tx, userId)` returns `QuoteListItem[]` as customer or provider; `quotePdfUrl(tx, userId, id)` returns a signed link (600 s, `INVOICE_LINK_SECONDS`); 404 for anyone but the two parties, 409 `NOT_READY` before the file exists.

- [ ] **Step 1: Write failing tests**: pdf.test renders non-empty bytes with the number, the total and the start; special characters in names do not break it (reuse the invoice tests' cases); int spec: numbers are consecutive per provider and year, two simultaneous quotes get different numbers, a failed storage put leaves `file_key` null and the next sweep stores it, a third user gets 404 on list and link.
- [ ] **Step 2: Run** `pnpm --filter @kando/domain test -- quotes` and the int spec: expect failure.
- [ ] **Step 3: Implement** the three files; hook `issueQuoteDocument` into the post-commit step of `sendQuote` (Task 5) and add the retry to the existing sweep.
- [ ] **Step 4: Run** the Step 2 commands: pass.
- [ ] **Step 5: Commit** `feat(domain): numbered quote PDF, lists and download link`.

### Task 8: Routes

**Files:** modify `apps/web/app/app-api/v1/requests/route.ts` and `[id]`, create `quotes/route.ts` (list), `quotes/[id]/pdf/route.ts`, `quotes/[id]/confirm/route.ts`, `requests/[id]/answer/route.ts` (provider answers), `requests/[id]/revise/route.ts`; test `apps/web/tests/quote-routes.int.spec.ts`.

- [ ] **Step 1: Write failing route tests** for each: success shape, 400 on a bad body, 401 signed out, 403 wrong side, 404 stranger, 409 closed; and the PDF route returns a link only to the two parties.
- [ ] **Step 2: Run** the spec: expect failure.
- [ ] **Step 3: Implement** thin routes with `parseBody` + the Task 2 schemas, calling Tasks 4 to 7.
- [ ] **Step 4: Run** the spec: pass; `tsc` for web.
- [ ] **Step 5: Commit** `feat(web): routes for answering a request, confirming a quote and the quote lists`.

### Task 9: Notices (in-app, push, email) in German and English

**Files:** modify `packages/i18n/src/{en,de,en-server,de-server}.ts`, `packages/domain/src/email.ts`, `packages/domain/src/notifications-store.ts` (kind literal), `apps/mobile/src/lib/notification-text.ts`; test `packages/i18n/src/index.test.ts`, `apps/mobile/src/lib/notification-text.test.ts`, `apps/web/tests/booking-notifications.int.spec.ts`.

Texts (English; German written to match in the same task):
- `request-received` (provider): "New request: {service}, {date}. Open it to accept and send a quote."
- `quote-received` (customer): "Your request was accepted. A quote is ready: confirm it to book and pay."
- `time-proposed` (customer): "The provider proposed a different time. Confirm it, open the chat, or decline."
- `request-updated` (provider): "The customer changed the time of a request. Please answer."
- `request-declined` (customer, existing): add "Please contact a different provider." with the button in the app (Task 10).
- the old `booking-proposed` text stays for old rows.

- [ ] **Step 1: Write the failing tests** (parity, text mapping for the two new kinds, one stored notice plus one outbox email each).
- [ ] **Step 2: Run** the three specs: expect failure.
- [ ] **Step 3: Implement** the texts, the push title and body per kind, the email templates (fixed placeholders only, as today), the mobile map.
- [ ] **Step 4: Run** the specs: pass.
- [ ] **Step 5: Commit** `feat(notices): texts for the one-flow request, quote and time proposal`.

### Task 10: App - request form, provider answer panel, customer quote screen

**Files:** modify `apps/mobile/src/screens/bookings/{request-form,request-detail,booking-detail,time-proposal-form,quote-card}.tsx`, `apps/mobile/src/screens/bookings/proposal-screens.tsx`, `apps/mobile/src/api/bookings.ts`; create `apps/mobile/src/screens/bookings/provider-answer.tsx`; tests next to each (jest).

Screens and behaviour:
- **Customer: one form** for "Request a quote" and "Book": service, description, date, time, duration, on site or remote (address if on site), photos as today. The old "Book" button for a fixed-price service opens the same form with the service chosen; there is no second path. One button: **Send**.
- **Provider: request screen** shows every field prefilled from the customer, the price field prefilled with the service's fixed price when it has one (else empty). Three buttons: **Accept and send quote** (grey until the price is filled), **Propose a different time** (opens the two choices already built in commit `d60e00a`: **Open chat** / **Enter proposed date/time**), **Reject** (one confirm, optional short reason for the customer).
- **Provider: with or without a final time.** A switch on the answer panel, "Date and time confirmed" (default on). Off: the time fields grey out and the quote says "to be confirmed"; **Accept and send quote** still needs the price.
- **Customer: quote screen** (from the notice or the request): the quote with start, duration and total, and **Confirm and pay** for a quote with a time (confirms, then opens payment straight away on the booking page; read `pay-card.tsx` first and start its pay action from a screen param, do not copy it), **Open chat**, **Decline**. For a quote without a time the first button reads **Accept quote**: it books without paying, and the booking page then shows the agree-the-time step (**Open chat**, **Enter the agreed time**, and **Confirm time and pay** when the other side entered one). Decline (opens a box first: "Do you want to talk to the provider first?" with **Open chat** and **Decline anyway**; only **Decline anyway** declines). When the provider proposed a different time the text says so. After the round rule, the screen shows only **Open chat** and **Decline**, plus **Enter the agreed time** once chat contact exists.
- **Rejected provider:** the request screen shows "This provider cannot do this job" and a button **Find another provider** that opens search with the same category and postcode; the interaction is over (no actions).
- Friendly errors for every new code (`slot-pending`, `chat-first`, `quote-not-open`, `quote-expired`) with the step to take.

- [ ] **Step 1: Write the failing jest tests** for the pure parts: which buttons show for each state and role (a small `quoteActions(request, quote, viewer)` function in `apps/mobile/src/lib`, like `bookingActions`), the prefill mapping from request to answer form, and the round-rule display.
- [ ] **Step 2: Run** `pnpm --filter mobile test -- quote` : expect failure.
- [ ] **Step 3: Implement** the screens using the existing building blocks (`FormScreen`, `TimeProposalForm`, `OpenChat`, `useSubmit`, `confirmDanger`).
- [ ] **Step 4: Run** the mobile specs and `tsc`; lint the changed files.
- [ ] **Step 5: Commit** `feat(mobile): one request form, provider answer panel, customer quote screen`.

### Task 11: App - Quotes sent and My received quotes, download and print

**Files:** create `apps/mobile/src/screens/quotes/{quote-list,quotes-card}.tsx`, `apps/mobile/src/app/quotes/{_layout,index}.tsx`, `apps/mobile/src/api/quotes.ts`; modify `apps/mobile/src/screens/account-screen.tsx`; tests `apps/mobile/src/api/quotes.test.ts`, list tests like `invoices.test.ts`.

- The account page gets a **Quotes** card (like `InvoicesCard`): everyone sees **My received quotes**; providers also see **Quotes sent**. Each list: number, counterparty, start, total, status (current, replaced, expired, accepted), newest first. A row opens the PDF through the signed link (`WebBrowser.openBrowserAsync`, the same way the invoice list opens its PDF); download and print are done from the phone's PDF viewer or browser. No new dependency.

- [ ] **Step 1: Write failing tests** for the API wrapper (URLs, errors) and the list mapping.
- [ ] **Step 2: Run** `pnpm --filter mobile test -- quotes`: expect failure.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** tests, `tsc`, lint.
- [ ] **Step 5: Commit** `feat(mobile): quotes sent and received quotes with the PDF`.

### Task 12: Retire the old proposal path for new jobs

**Files:** modify `packages/domain/src/bookings/{bookings,requests}.ts`, `apps/web/app/app-api/v1/bookings/**`, `apps/mobile/src/screens/bookings/{booking-detail,proposal-screens}.tsx`, `apps/mobile/src/lib/booking-status.ts`; update their tests.

- `POST /bookings` (direct booking) and the quote-to-`proposed` path are removed from the app: a new job never enters `proposed`. The status stays in the database check and in `bookingActions` so any old `proposed` booking can still be answered, declined or can expire; remove that handling in a later clean-up once none exist (check production first).
- The "Accept this time / Propose a different time" buttons of commit `d60e00a` stay, because they serve those old rows.

- [ ] **Step 1: Write/adjust failing tests**: `POST /bookings` is gone (404) or refused with a clear code; old `proposed` bookings still answer correctly.
- [ ] **Step 2: Run** the affected specs.
- [ ] **Step 3: Remove** the dead entry points; keep the shared pieces (`TimeProposalForm`, the answer function for old rows).
- [ ] **Step 4: Run** the specs, `tsc`, lint.
- [ ] **Step 5: Commit** `refactor: new jobs use the one request flow; the proposed path only serves old rows`.

### Task 13: Stage test, README and phone test

**Files:** `Reports/<date>-flow-1-test-report.md`, `README.md`.

- [ ] **Step 1: Run the full suites once**: `pnpm -r typecheck`, `pnpm lint` (the 38 local scratch-script errors are expected and not in CI), `pnpm --filter @kando/domain test`, `pnpm --filter web exec vitest run`, `pnpm --filter mobile test`, `pnpm --filter @kando/contract test`, `pnpm --filter @kando/i18n test`.
- [ ] **Step 2: Write the test report** in `Reports/` (what ran, counts, failures with output).
- [ ] **Step 3: Update the README** (the "What is built" section, "Fixes from the owner's phone testing", next steps; remove the old two-path description).
- [ ] **Step 4: Phone test script for the owner** (Android and iPhone), each with production data: (1) customer sends a request with a time; (2) provider sees it prefilled, price empty, **Accept** grey; (3) fills price, **Accept and send quote**; (4) customer sees the quote and the PDF appears in **My received quotes** and **Quotes sent**; (5) **Confirm and pay** opens payment, booking becomes Booked after the test payment; (6) provider **Propose a different time** both ways (chat, enter time); (7) one proposal each way then chat-only; (8) provider **Reject**: customer sees **Find another provider**; (9) two customers confirm the same time (second sees the plain message); (10) download and print the PDF; (11) a quote **without** a time: the customer accepts, both agree the time in the chat, one enters it, the other confirms, then payment.
- [ ] **Step 5: Commit** `docs: flow 1 test report and README`.

### Task 14 (optional, the owner decides): "Needs your answer" strip on the account page

Replaces the earlier idea of a pop-out that cannot be closed (phone-test Item 3). A short list at the top of the account page of everything waiting for the person's tap (a request to answer for a provider, a quote to confirm for a customer), each opening its screen, with the existing dot on the tab. No blocking dialog. Build only if the owner still wants it after phone-testing Task 10.

## What stays the same

Payments, payouts, the 24-hour free cancellation, finishing, disputes, reviews, invoices (the quote number series is separate), chat, additional tasks and the back office are not changed.

## Open points for the owner during the build

1. The quote PDF language: the provider's language (default German), one language per PDF. Tell me if you want both languages on one page.
2. (Decided 1 November 2026) A customer who taps **Decline** is first offered the chat with the provider: a box "Do you want to talk to the provider first?" with **Open chat** and **Decline anyway**. Only **Decline anyway** ends the interaction and tells the provider.
3. Quote validity is 7 days or until the start time, whichever is earlier.
4. **Payment for a quote without a time.** Recommended and built by default: the customer accepts the quote, the time is agreed afterwards, and payment is asked only after that (so no money is taken for an unknown time, and the 24-hour free-cancellation and no-show rules always have a real start). The alternative is to pay at acceptance; it needs the cancellation, no-show and release rules to cope with a missing start, which is a larger change. Say if you want the alternative.
5. A quote without a time stays unchanged as a document. Should a second PDF (a booking confirmation with the agreed time) be issued once the time is agreed? Not in this plan; say if you want it.
