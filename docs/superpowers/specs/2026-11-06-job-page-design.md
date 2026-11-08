# One job, one page: design for the four fixes from the user-experience test

Date: 6 November 2026. Status: draft for the owner's approval. Source: `Reports/UX-Test-Report-2026-11-06.docx` and the diaries in `Reports/ux-test/`. Architect input and the owner's decisions from the design conversation are folded in; decisions the owner made are marked **(owner)**, calls made by the writer are marked **(my call)**.

## 1. Why

Three test users ran six jobs through the phone app. The core idea works (one job, the dog walk, went from request to reviews in both directions), but everything around the money and the paper trail does not: a job lives in five places with no links between them, a stuck payment says "being processed" for ever, a provider cannot go live and is not told why, and a provider cannot see what they will earn. These four problems cost the test users the most time and trust, and they are the ones this project fixes. The other findings of the report must be able to land afterwards without rework.

## 2. Goals, non-goals, anti-goals

Goals
- One place per job (the job page) that shows everything about that job to both sides, in the same words.
- One list of jobs that tells each person what needs them now, what is running, and what is finished.
- One honest payment status, with a date and a way to reach us when something is wrong.
- A going-live checklist that says what is missing, and a quote button that says what is missing.
- A provider money view: what I receive, when, and the commission before I take a job.
- Very simple: no new table for the job, no second copy of any fact, the fewest new screens.

Non-goals (not in this project, but must stay possible)
- Full-text search inside chats; a counter-offer button; availability (opening times); receipt tax wording and tax number (needs a tax adviser); the dispute screens' appeal and evidence upload; the German wording pass (du or Sie, term list); notification push and email texts beyond naming the job; the Stripe payout flow's two-visit problem; date and time pickers. Section 9 says where each of these plugs in.

Anti-goals (a failure even if it technically works)
- A second "jobs" table, a copy of the request or booking data, or two lists that can disagree.
- A status text that says "being processed", "pending" or "in progress" without a date or a next step.
- A new screen where an existing one can be extended.
- A change that breaks the app builds already installed on phones (API changes are additive only).

## 3. Constraints (from CLAUDE.md and the architect)

- Every user-facing text exists in German and English (`packages/i18n`); notices also need push, email and in-app texts (`notification-parity.int.spec.ts`).
- No new table without an entry in `packages/db/src/rls.ts`; this design adds none. Money is read on the owner connection after the existing party check; the ledger's access rules are not loosened.
- Installed app builds do not check server answers: add fields, never rename or reuse status values; a new status value must have a fallback text in the old builds.
- A migration runs on the dev branch first and on production before the code that uses it.
- No new Germany-only assumptions: currency and country come from the country record. The commission rate is a constant today (a South Africa debt: flag it, do not fix it here).
- Never lock a row on the request connection and write it on the owner connection.
- One branch and one pull request per piece; the owner merges; German checked by the writer, reviews in English.

## 4. The design

### 4.1 The job is the request (no new table)

Every root booking already has a `requestId`, the chat thread is keyed on the root request, and additional tasks point back with `parentBookingId`. So the **job is the root request**. What it gets:
- **A job number**: one additive migration adds an auto-numbered integer to `requests`, written only by the database, starting at 1000, shown as `#1044`. Additional tasks show the parent's number and a counter (`#1040-2`). **(my call: a global sequence, shown as a plain number.)** Quotes and receipts keep their own numbers for tax reasons but print the job number too.
- **A title**: one server rule used by every screen, notice and PDF: the title the provider typed for the service, else the category name. One of the two always exists. **(owner confirmed; the text fallback is dropped.)** This also fixes the service title that differs between the public profile and My business.
- **One server function that picks the "current" booking of a request** (a request can have an expired booking and then a new one). Every screen, invoice link and push link goes through it, so screens never disagree.

### 4.2 The Jobs list (replaces Correspondence)

The Correspondence tab becomes **Jobs**. The existing request/booking list screen (`my-bookings.tsx`) is extended; the four lists (requests, quotes, messages, invoices) stop being separate lists. **(owner)**

- **Switch** "As customer / As provider" stays, each side with one counter. The counter counts **jobs** that need me or have unread messages (a job counts once). The tab badge is the two counters added. **(owner; counting per job is my call)**
- **Three sections, a job is in exactly one:**
  - **Needs you**: something I can do right now. Always visible. **(owner)** Includes a job with unread messages and nothing else waiting.
  - **Active jobs**: running or planned, and the next move is someone else's. Problems and delayed payments come first, in red.
  - **Past jobs (n)**: settled and over (completed and paid out, cancelled and refunded, declined, expired). Folded, shows only the count; opened it shows the latest 10 by month, one line per job (title, date, outcome), with "Show more". A finished job whose money is not settled stays under Active. **(owner; the name "Past jobs" and the settled-only rule are my call)**
- **Search** looks in all three sections at once: job number, other person's name, title. Results carry a small tag (Active, Past). No filter chips. **(owner)**
- **Provider only:** a money strip on top (received this month, on its way, on hold; all net of commission; tapping an amount shows the jobs behind it) and an "Invoices ›" link in the header to receipts and the monthly commission invoices, which belong to a month, not to one job.
- Rows show the title, job number, other person, date and a plain status chip. In the rare case that a provider's readiness was lost after a request was made, the row says what is missing ("New request. Set up payouts to send a quote.").
- **As built (PR 4):** a new `GET /jobs?role=&section=&q=&cursor=` returns the rows (job number, title, other party, date, job state, unread) and the counts (needs you, unread, past). Only the Past section and search are paged; Needs you and Active return the whole open set. The old list endpoints `GET /requests`, `GET /bookings` and `GET /threads` were removed because nothing used them any more (owner decision, 8 November 2026); `POST /requests` and the single-item routes stay. The money fields are added in PR 5.

### 4.3 The job page (extends the request detail screen)

`request-detail.tsx` becomes the job page; the content of `booking-detail.tsx` moves into it as a section. `/bookings/[id]` stays as a route (push links, installed builds) and opens the job page. **(architect)**

Top of the page, the same for both sides: a **two-column, three-line grid with label and value on one line**: Job #, Customer (provider's view) or Provider (customer's view), Date (with the year as '26; in German numeric, 25.11.'26), Time, Duration, Location (postcode and city; the street appears once booked, as today). **(owner)** The whole block uses **one font**: label and value have the same size (12), weight (semi-bold) and colour, and a colon after each label keeps them readable as pairs. **(owner)** Each cell stays on one line and is cut with "…" if a value is too long; it was checked to fit at phone widths of 360 and 390 (also in German, also with a long name such as "Maximilian K."). Under it: the status card (section 4.4) with its buttons, then the provider's money box (4.6), then sections in this order: your request, quotes (every version, the accepted one marked, with what was asked next to what is offered), chat, additional tasks (with one total), receipts, dispute, reviews. Additional tasks are a part of the job, not a second booking in the list.

The customer's quote screen shows the request text beside the quote ("Your request asked for 30 to 40 photos") so a mismatch is visible before accepting.

### 4.4 One derived status (replaces "Payment pending")

The server computes **one job state** from fields that exist (booking status, paid and released dates, confirm-by date, checkout reference, open dispute, open staff flag, provider payout readiness) and returns a state key, the section, the amounts and dates, and the buttons each side may show. The app only renders it; the payment cases in `apps/mobile/src/lib/booking-status.ts` and the phone-memory pay state (`lib/pay-state.ts`) are replaced, not kept beside it. Every text says what happened, what happens next with a date, and what you can do.

| State | Customer sees (section) | Provider sees (section) | Buttons |
|---|---|---|---|
| Request sent | Request sent, answer expected by {date} (Active) | New request, answer by {date} (Needs you) | Provider: Send a quote, Decline. Customer: Withdraw request. Both: Open chat |
| Quote sent | Quote €{x} waiting, valid until {date} (Needs you) | Quote sent, waiting for the customer (Active) | Customer: Accept quote. Both: Open chat |
| Payment due | Pay €{x} by {date} (Needs you) | Waiting for the customer's payment (Active) | Customer: Pay now |
| Checkout not completed | Your payment did not go through, nothing was charged (Needs you) | Waiting for the customer's payment (Active) | Customer: Pay again |
| Paid, work upcoming | €{x} paid, held safely until the job is done (Active) | Paid, you receive €{net} after the job (Active) | Customer: Add an additional task. Both: Open chat, Cancel the booking |
| Start time passed | Job time has started (Active) | Job time has started, mark it finished when done (Needs you) | Provider: Job finished. Both: The other side did not turn up |
| Before the start time | – | You can mark this finished from {start time} (Active) | Provider: Job finished (greyed, with the line) |
| Work done, waiting | Work done, confirm or report a problem by {date}, otherwise €{x} is paid out then (Needs you) | Finished, €{net} is paid out on {date} unless a problem is reported (Active) | Customer: Yes it was done, Report a problem |
| Payout on its way | Confirmed, €{x} goes to the provider on {date} (Active) | Confirmed, €{net} sent to your payout account on {date} (Active) | Open chat |
| Payout account missing | Confirmed, the payout waits for the provider (Active) | Set up payouts to receive €{net} (Needs you) | Provider: Set up payouts |
| Problem reported | On hold, our team decides by {date}, job #{n}, no money moves until then (Active, red, first) | same | Both: Open chat, Contact support |
| Delayed | Delayed, we could not complete the payment step, our team is on it (Active, red) | same, with the amount waiting | Both: Contact support |
| Completed | Paid €{x} (Past) | €{net} paid out on {date} (Past) | Both: Write a review, Receipt (PDF) |
| Cancelled | Cancelled, €{x} refunded on {date}, or refund on its way (Past); a failed refund is "Refund delayed" (Active, red) | Cancelled by the customer, nothing to pay out (Past) | Open chat |
| Declined or expired | Declined by the provider, or time ran out, nothing charged (Past) | You declined, or time ran out (Past) | Customer: Ask someone else in the same category |

- "Delayed" is the only state that says "our team is on it"; it always has Contact support, which opens an email to `info@skillweb.space` with the job number and title filled in (no new screen). It appears when the booking is finished or confirmed and the release or refund failed (an open `payment-unprocessed` staff flag), or a dispute decision's money step keeps failing. **(my call: email, not an in-app form.)**
- The provider does **not** see "Report a problem" on a finished job (the test found it confusing); a provider with a problem uses the chat or Contact support. The server rule that lets either side open a dispute stays unchanged for now. **(owner confirmed)**
- "Provider has no payout account" is derived from the payout status the app already loads.
- Stripe's bank payout date is not known to us, so the wording is "sent to your payout account on {date}".
- A refund counts as done once: the cancel and settle code must treat "charge already refunded" as success when the amount due is covered (the test showed a second refund attempt on a cancelled booking). Everything else in `settle.ts`, `webhook.ts`, `ledger.ts` and the timers stays untouched.

### 4.5 The Live checklist and the quote gate

- **Live checklist** on My business, under the Live switch. The server already returns a `missing` list; the app currently ignores it. The switch says how many things are open ("2 things to do first") and the list shows every item, each opening its own field. Items we are checking show "Awaiting approval" with the small line "We are checking it" (for example the Photo ID). When everything is done the list turns into a green summary and the stale Home banner ("Your payouts are set up. Agree to invoicing...") is no longer needed. **(owner)**
- **Provider type** shows as a question ("Choose Private person or Business"), not as a chosen value; no default is saved (choosing Business brings the business name and legal notice). The bug is the placeholder in `lib/compulsory.ts`. **(architect; owner approved the checklist)**
- **Live stays as it is:** the payout account, the invoicing consent and, for small businesses and businesses, a tax number or VAT ID (the three things the server's `canTransact` rule in `payments/rules.ts` checks) are **not** required to go live. The checklist shows them as a second group headed "Before customers can book you", each with a "Do it ›" link (about 5 minutes with Stripe for the payout account, one tap for the invoicing consent); the tax number item appears only for those two provider types. **(owner for the grouping; the tax number item and the heading are my call after reading the server rule)**
- **What the server does today, and keeps doing:** a customer's request to a provider who cannot transact is refused (`PROVIDER_NOT_READY`, the app shows "notify me"), and so is a quote (`PAYOUT_SETUP_FIRST`) and a quote's confirmation (`PROVIDER_NOT_READY`). So a provider who is live but not ready is found but cannot be booked, and the checklist says why. This stays as it is **(owner confirmed)**.
- **The "Send a quote" button** follows the same rule for the cases where readiness is lost after a request exists (payout account stops being ready, consent withdrawn): it is greyed, and right under it a box lists whichever steps are missing ("To send quotes, 2 steps are missing", each with "Do it ›"). Decline and Open chat keep working. **(owner)** The refusal is already on the server; the app only shows it before the tap.

### 4.6 The provider money view

- **Money box on the job page:** price, additional tasks as lines of the same job, the total paid by the customer, **commission 15%** (the rate is read from the one constant, never typed into a text), and **You receive** (net), with the payout date in the status card above. Before payment, the rate is the current one and the line is marked expected. After payment it is the rate stored on the booking.
- **Jobs list strip:** received this month, on its way, on hold (net amounts).
- **Commission before the job:** a live line under the amount on the quote form: "You receive €102.00 after 15% commission, payment fees included." **(owner, 6 November 2026)**
- The numbers are computed on the owner connection after the existing party and own-provider check; the ledger tables stay staff-only.
- **Commission rate: 15%, payment fees included, set by the owner on 6 November 2026 (it replaces the 12% of earlier today). She may change it after more research**, so the rate lives in exactly one constant (`COMMISSION_RATE`) and every text and example takes it from there. The code comment in `packages/domain/src/payments/rules.ts` ("PLACEHOLDER: the owner has not decided the rate") and the README reminder must say: 15% including Stripe's payment fees, provisional, to be reviewed after research. The terms must say the fees are included. Bookings already paid keep the rate stored on them. The mockups still show 12%; the text wins.
- **Money strip text:** the explanation under the strip is one line in the smallest text size the app already uses ("After commission and fees"), nothing more.

### 4.7 Materials are not coded **(owner)**

Provider and customer agree about materials, and it goes into the quote text where relevant; **the receipt shows one amount only**. So:
- The "Of which material costs" field at "Job finished" is removed; the quote form gets a one-line hint in its scope field ("Mention materials here if the price includes them").
- `bookings.material_amount` and its check constraint are dropped by a migration; invoice building (`invoices/build.ts`, `invoices/issue.ts`), the admin bookings view and the share calculation of a stopped job no longer split labour and materials. Receipts and invoices already issued keep their stored content unchanged. The drop is a separate, last step so the code that stops using it is deployed first.

### 4.8 Notices name the job

The notices the app reads from `/me` get the job number, title and other party (looked up when the app reads them) and open the job page, not the list. The push, email and in-app texts get a job parameter (German and English together, `notification-parity` enforces it). This makes every notice a doorway to the job page. Clearing a notice when its action is done follows from the "Needs you" rule (a notice shows only while the job is in that state); doing it for every banner is the follow-up in section 9.

## 5. What stays untouched

`settle.ts`, `webhook.ts`, `ledger.ts`, the timers, invoice numbering and already issued invoices, the chat thread model, the `rls.ts` classes, the Stripe configuration.

## 6. Risks (named by the architect)

1. A request can have several bookings: picking the current one must live in one server function.
2. The payment state has many inputs: it must replace the old payment cases, not sit beside them, or two statuses will disagree.
3. The list query gets heavy (unread counts, money, flags) and sorting by state does not combine well with paging by date: page per section.
4. Installed app builds: additive fields only; the job-number migration on production first (it locks the table briefly).
5. A new job state key shown by an old build appears as a raw key: every new key needs a fallback text.

## 7. Build order: five small pull requests

1. **Live checklist and quote gate** (app and texts, plus the server's refusal of quotes without payout and invoicing). Needs no migration.
2. **Job number, title rule, job fields** on requests, bookings, quotes, threads, invoices and notices; the notices name the job.
3. **Derived job state, Contact support, refund-once fix**, replacing "Payment pending" and the phone's pay memory.
4. **Jobs list and job page** (sections, switch with counters, search, header grid, hiding "Report a problem" for the provider).
5. **Provider money view** (strip, box, quote-form line) and **removal of materials** (code first, column drop last), and the commission rate comment.

**Builds and releases (owner, 6 November 2026):** the order for every change is: migration on production first (additive only), then the server deploy, then an app build only when a screen needs the new field. The server is deployed after every pull request; **pull requests 1 to 4 are tested by the owner in the phone-sized browser setup, with no test build; one test build for the phone is made when pull request 5 is ready and before it is merged** (owner, 6 November 2026). An extra build only if the owner asks. JavaScript-only changes may go out through EAS Update. **Rule for pull request 5:** installed builds still send the materials amount at "Job finished", so before the column drop the server must accept that field and silently ignore it. The column drop is the very last step.

Each is one branch and one pull request, merged by the owner; before each merge: `/code-review --comment`, fix, and a GitHub review (Approve). Texts in German and English; per task only the affected specs and `tsc`; the full suites once at the end, with a test report in `Reports/`.

## 8. Decisions still open for the owner

None. All three were answered by the owner on 6 November 2026:
- Commission: **15%, Stripe payment fees included, provisional** (section 4.6).
- The provider does **not** get "Report a problem" on a finished job (confirmed).
- A provider who is live but not ready **stays not bookable**, as the server does today. The "Send a quote" box only appears when readiness is lost after a request exists (confirmed).

## 8b. Calls made on the builder's questions (all mine, to check while reading)

1. **Quote gate and quotes in flight:** the refusal applies to every new or revised quote, including quotes for additional tasks. A quote already sent stays valid; nothing is revoked. Confirmation of an existing quote is refused only if readiness was lost since (the server already does this).
2. **Old builds and the derived state:** pull request 3 only **adds** the new state key, section and amounts to the API answers; the old payment fields keep being returned unchanged until the owner decides to retire old builds. Old builds keep showing their old texts; they cannot show a fallback for a key they do not know. **Owner condition: additive only, and every new field or screen that depends on a new table or column ships in the same app build that needs it** (the owner agreed on that basis; the new app build is released together with the pull request that adds the field).
3. **Old booking ids:** any booking id, current or older, opens the job page of its request, scrolled to that booking's part. Notices and push links carry the request (job) id from pull request 2 on; the current-booking function decides which booking is shown as current.
4. **Job numbers:** existing requests are numbered in creation order by the migration; the numbers start at 1000. An additional task's number is worked out each time it is shown, not saved: the job's number, a dash, and the task's position among that job's bookings in the order they were created (the first booking is the job itself, the first additional task is `-2`). Bookings are never deleted, so the position never changes. It is used wherever the task appears (status card, money box, notices, receipt), and the same function produces it everywhere. Gaps after deletion are fine: the job number is a reference for people, not a tax document number (quote, receipt and invoice numbers keep their own series).
5. **Section rules:** "Needs you" holds only things that move the job forward (answer a request, send or accept a quote, pay, finish, confirm, set up payouts, or an unread message). "Open chat" and "Contact support" do not count as actions. A job with a problem or a delayed payment sits in Active (red, first) whatever else is open; it adds to the counter only if it has unread messages.
6. **Materials removal:** the amount only ever split labour and materials on invoice lines (`invoices/build.ts`); it never changed what was charged or paid out, so unsettled and stopped jobs are unaffected. Unissued invoices simply show the one amount. No backfill is needed; the column drop is the last step after the code stops reading it.
7. **Money strip:** "received this month" is the net paid out with a release date in the current calendar month. "On its way" is the net of every paid job not yet released and not on hold (paid and upcoming, finished, confirmed, waiting for the provider's payout account). "On hold" is the net of jobs with a problem reported or a delayed payment. Net uses the commission rate stored on the booking at payment (the current 15% before payment); a job with additional tasks is the sum of its parts, each at its own stored rate.

## 9. How the other report findings land (so nothing is redone)

Report finding numbers: "F" are the ten top findings, "B" the 21 bugs, "S" the 24 suggestions.

| Finding | In this project | Plugs into |
|---|---|---|
| F1 single place, S6, S8, S9 | Yes: job page, Jobs list, status card with what happens next | |
| F2, B4, B5, B17, S2, S17 | Yes: derived state, Delayed, refund-once; the cancel result shown at once is a refetch after the action | State key and refund line |
| F3, B1, S1 | Yes: checklist, provider type placeholder | |
| F4, B8, S7 | Yes: money box, strip, commission line; B8 disappears with materials removal | |
| F5, B6, S3 | Partly: notices name the job and open the job page; the "Needs you" counters replace the count mismatch | Follow-up: derive every Home banner from the job state so stale ones disappear |
| F6, B10, S4 | Partly: the job page shows the price; "Book" vs "Request a quote" label and the missing service name need the title rule | Follow-up on the service card button |
| F7, B9, S10 | No (needs a tax adviser); the receipt gets the job number | Receipt template, job number is already available |
| F8, B2, S5 | No | Native date and time pickers; the weekday is shown in the header grid |
| F9, B7, B14, S13 | Partly: the status card shows the decision as the heading and the stale heading goes away because the heading is the derived state | Dispute reply, evidence, reference number (the job number), appeal |
| F10, S11 | Yes: switch with counters; role names on notices follow from the notice fields | |
| B3, S16 | Yes: "Job finished" greyed with the time | |
| B11, S20, S21 | Partly: request next to quote; quote validity wording sits in the status card | Counter-offer button, validity edit |
| B12 | Partly: wording only | |
| B13 | No | German pass |
| B15, B18, B20, S18, S22, S23 | No | Separate small fixes |
| B16 | Yes: hidden for the provider | |
| B19 | Yes: the title rule | |
| B21 | No (test artifact); the Delayed state covers it | |
| S12, S14, S15, S19, S24 | No | Separate small fixes; availability is on the owner's later list |

## 10. Left to the builder

Names of fields and state keys; the exact SQL of the migration and the current-booking function; how paging per section is implemented; the German texts (checked by the writer; a German speaker should read them); loading states; whether the money strip's numbers come from a query or a summary table (prefer a query).

## 11. Mockups

The approved mockups are in `docs/superpowers/specs/assets/2026-11-06-job-page/` (open the HTML files in a browser): `sections-v3.html` (the Jobs list, customer and provider, search), `job-header-v3.html` (the header grid, one font), `status-and-live-v2.html` (every status, who sees which button; its Live checklist is superseded by `live-and-quote-gate.html`), `live-and-quote-gate.html` (checklist and quote gate), `money-and-stuck.html` (money view and stuck-payment wording). Where a mockup and this text differ, this text wins (the mockup still shows the old "materials" line).
