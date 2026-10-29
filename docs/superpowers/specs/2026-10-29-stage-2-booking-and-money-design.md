# Stage 2: booking and money, design for the first release

29 October 2026. Status: for owner approval. Written from the design conversation with the owner. It replaces the booking and money rules of `docs/specs/2026-10-26-kando-foundation-design.md` where they differ (section 8). Everything not mentioned here stays as in the foundation design.

## 1. Intent

Today KANDO is a directory: people find and read about checked providers. This stage lets a customer actually hire one and pay safely: ask for a quote or book a fixed-price service, agree the time, pay, have the work done, review each other, and the provider is paid if nothing went wrong. The point is trust on both sides: the customer's money is not released until the work is done, and the provider knows the money exists before they start.

## 2. Goals, non-goals, anti-goals

**Goals (first release of Stage 2)**
- Customer requests a quote from a provider; provider quotes; both can chat and negotiate; the customer accepts.
- Direct booking of fixed-price services (not hourly, "from" or "on request" ones).
- The customer pays the full agreed amount up front; it is held until the job is done.
- Reviews both ways, written blind, shown together.
- Disputes, cancellations, a "stop job halfway" path, and "Additional task" for scope changes.
- Payout set-up for providers (Stripe Connect) and the verified mark.
- Chat inside each request or booking, with contact details blocked until the booking is paid.

**Non-goals (deferred on purpose, see section 10)**
- Deposits, recurring bookings, weekly opening hours or a slot picker, per-category cancellation rules, AI helpers such as suggested times.

**Anti-goals (the feature has failed even if it works technically)**
- A customer's money released to a provider who did not do the job, with no way back.
- A provider doing work for a customer whose payment has not been secured.
- People moving to phone or email at any stage so the protection and the evidence in the chat do not apply.
- Any text that promises "Treuhand", "Escrow" or "Garantie" (banned in the foundation design). Use plain wording such as "paid when the work is done" and "payment protection", subject to the lawyer (section 9).

## 3. The flow (owner decisions unless marked "my call")

### 3.1 Request and quote
1. The customer sends a request to one provider: description, photos, preferred date, job address (kept private until the booking is accepted). Opens a chat.
2. The provider answers within 3 days (foundation default, my call) or the request expires. **Ignored requests (owner decision):** when a request expires without an answer, the customer is notified that the provider is not available at the moment and is asked to contact a different provider (my call: this applies to every expired request, not only the third). When a provider lets 3 requests expire within one month, they are sent a notification that explains why ignoring requests is bad for their business (customers leave, their ranking and trust suffer, the app shows them as unavailable) and asks them to confirm that they still want to be on the platform or to withdraw their services. My call: a provider who withdraws has their profile unpublished; if they have not answered after 14 days, staff are told, and nothing is removed automatically. A quote the customer has not accepted expires 7 days after it was sent. The 7-day expiry is shown on the quote screen and in the message the customer receives, with a reminder 1 day before.
3. The provider sends a quote (price, scope, terms, optionally a suggested date and time). They may negotiate in the chat and revise the quote. The customer accepts one version; the accepted version is frozen.
4. Accepting a quote does not by itself agree the date and time (owner decision, 29 October 2026). After acceptance the customer proposes date, time, duration and on-site or remote (a quote's suggested time can be kept), and the provider accepts or proposes another time: the same date-and-time confirmation as for a direct booking (sections 3.2 and 3.3).

### 3.2 Direct booking (fixed-price services only)
- A service with a fixed price shows "Book"; other services show "Request a quote".
- The customer proposes date, time and duration and the job address. The provider accepts, or proposes another time that the customer may accept. A direct booking and an accepted quote become the same kind of booking record.

### 3.3 Agreeing the time, and "Pending booking"
- No opening hours or slot picker. Customers see only that a time is "Pending booking" or "Booked" (no names, no details); the provider sees their own list.
- From the provider's acceptance until payment, the time shows as "Pending booking". A second customer may request a time that is pending; the provider is notified and may nudge the first customer. **First come, first served:** the first customer keeps the payment window; the second request moves forward when the first expires or the first customer taps "I no longer need this". The provider cannot override.

### 3.4 Payment
- After the provider accepts, the customer is told by email and in the app and gets a pay link. The booking is confirmed when it is paid.
- Payment window (my call, differs from the owner's first rule): within 48 hours of acceptance but never later than 24 hours before the start; with less than 24 hours to go, 6 hours. Reminders at about halfway and 3 hours before the deadline. An unpaid booking expires and the time is freed. The owner's original rule (24 hours before the start for bookings made further ahead) is acceptable if preferred; its cost is provider uncertainty.
- The customer pays the full amount. There are no deposits in this release.

### 3.5 Doing the job and finishing
- The provider taps "Finished". The customer is asked to confirm that the job is done and has **7 days from that moment** to confirm or open a dispute (owner decision, as in the foundation design). The customer gets reminders after 1, 3 and 6 days (owner decision) saying plainly that the payment to the provider is coming and when. Confirming, or 7 days without a response, releases the payment to the provider and the customer is told that the payment has been made. Confirmation triggers the reviews. Jobs such as babysitting may need a different rule later; the same rule applies to all categories for now.
- **Stop job halfway:** either side can press "Stop job" at any time. The money not yet earned stays frozen. The provider states what was done (for hourly-style work, the time worked). The two may agree a split with one tap; otherwise staff decide within 14 working days, defaulting to pay for time worked.

### 3.6 Cancellation (my call, to be confirmed by the lawyer)
- Free for either side up to 24 hours before the start; the customer is refunded in full.
- Later than that, a customer cancellation pays the provider 50% of the price (the 50% is my guess; one platform rule, one constant in one place). A no-show by the customer pays the provider in full.
- A provider cancelling late or not turning up: the customer is refunded in full, and it is recorded on the provider's profile (foundation design).
- A cancellation in time costs the customer nothing; KANDO absorbs the payment processing fee (my call, as far as known Stripe keeps its fee on refunds; to be checked).

### 3.7 Disputes
- The customer may open a dispute from the moment the provider taps "Finished" until the 7 days have run out. It freezes the money. A staff member decides within 14 working days using the chat and photos: full refund, partial refund or full payout, with a written reason to both sides. Without a dispute the money is released automatically.

### 3.8 Extra work ("Additional task")
- The accepted booking has an "Additional task" button for the customer and a "Scope/quote review" button for the provider. Either one starts a normal quote linked to the booking, labelled "Additional task", using the same quote, accept and pay flow. Work on the new part starts only after it is accepted and paid. Without acceptance the original job is all that is owed. The process is explained in a short note during negotiation so neither side is surprised.
- Payout, refund and invoice logic must handle several lines per booking.

### 3.9 Reviews
- After a job is confirmed, both sides write a review of the other before seeing the other's. Both appear together once both are in, or after 7 days. A review can be edited by its author for 14 days, then is final. Staff can hide one that breaks the rules. (The foundation design said 14 days for visibility; this changes it to 7, owner decision.)

### 3.10 Chat
- One chat per request or booking; text and photos only. Readable by the two people and by staff in a dispute. Messages cannot be edited or deleted (evidence). Quotes, acceptances and additional tasks appear as cards. Every message has "Report"; either side can block the other. Live delivery in the app, push and email otherwise.
- **Contact details are never available (owner decision):** phone numbers, emails and links are blocked in the chat at every stage, before and after payment, so all communication stays in the app for reference and mediation. This includes numbers written in words ("null eins fünf...") and spaced out. The job address is not a contact detail: it is entered in the booking and shown to the provider once the booking is accepted, and street addresses are not blocked in the chat (my call). Rules run first; an AI check reads what passes, once an EU provider is in place (section 9a). A blocked message is rejected, not edited, with this text (my draft, replacing the earlier wording): EN "Contact details can't be shared here. Please keep the conversation in the app: payment protection, reviews and our help with disputes only apply to what happens in the app." DE "Kontaktdaten können hier nicht geteilt werden. Bitte bleibt in der App: Zahlungsschutz, Bewertungen und unsere Hilfe bei Streitfällen gelten nur für das, was in der App passiert." The sender can rewrite and resend. Numbers in photos are not caught in this release; repeated attempts are flagged to staff. A risk to watch: an on-site provider cannot phone the customer, so a late or lost customer must be reachable in the app (push notification); if that proves too hard, in-app calling with masked numbers is a later option.

### 3.11 Payout set-up and unfinished providers
- Payout set-up (Stripe Connect, hosted by Stripe) is offered at sign-up with "I also want to offer services" and when a customer taps "Offer services". Stripe collects identity, address and bank account; the tax information for DAC7 is collected there too. Completion gives the verified mark.
- A provider may build a profile and be found without it, but cannot send quotes or accept bookings until it is complete.
- On such a profile customers see "Notify me when available" instead of the request and book buttons. The provider is told by email, in the app and by push that N customers want to book them, and to finish payout set-up (the count only, no names). When set-up completes, every interested customer is told "Now available".

## 4. Money rules

- The full amount is charged when the customer pays (not at confirmation as in the foundation design). The money is held by Stripe, never in KANDO's own bank account; KANDO's code only tells Stripe when to release it, when the criteria are met (customer confirmation or the 7 days passing, no dispute). It is paid out to the provider within 7 days of that release. Commission stays one percentage on the total the customer pays, processing fees inside it, no customer-side fee; the percentage is still undecided (foundation design); **the owner must finalise the commission amount before payouts or the Preise page are built (README reminder).** Failed charges: the booking is simply not confirmed until a payment succeeds.
- Money rows are append-only (foundation design). Refunds and payout adjustments are new rows.
- Chargebacks after payout: as in the foundation design.
- Invoices and receipts, the monthly commission invoice and the staff back office for bookings, money state, disputes and refunds stay as in the foundation design, adjusted for several lines per booking.

## 5. Constraints

- Everything user-facing exists in German and English; amounts in euro but currency-aware; South Africa comes later, so no new Germany-only assumptions.
- Every table with user data has row-level security. The chat check, payments and timers (expiry, reminders, auto-confirmation, payouts) run as background jobs (Inngest, as in the foundation design).
- Every change through a pull request merged by the owner; a test report in `Reports/` after the stage and after big changes.

## 6. Decided by the owner, as decided

Full payment up front, no deposits in release 1; provider accepts a booking before the customer pays; "Pending booking" with first-come-first-served; chat blocking of contact details at every stage, with AI for spelled-out numbers once a provider exists, and rejection with an explanation; "Additional task" reusing the quote flow, started only after accepted and paid; stop-job path; 7-day quote expiry made clear; reviews blind and shown together; payout set-up at sign-up with the "notify me" mechanism; one-off jobs only; "Finished" then 7 days for the customer to confirm or dispute, with reminders after 1, 3 and 6 days and automatic release of the payment; three expired requests in a month trigger a notice to the provider and the customer is told to try another provider; contact details are never shared in the chat; Stripe holds the money and releases it when the criteria are met; commission paid to KANDO at that same moment; 30 minutes free between on-site bookings; the whole money side is built behind an off switch (real payments stay off until the lawyer has cleared the points in section 9); the chat contact check ships with rules only (including numbers written in words) and the AI layer follows once an EU provider and a data processing agreement exist.

## 7. Left to the builder

Table and state design for requests, quotes, bookings and the chat; the exact booking states (for example requested, accepted-awaiting-payment, confirmed, finished, completed, disputed, cancelled, expired, paid out); the order of work inside the stage; Stripe Connect account type; realtime and push delivery mechanics; the rules-based contact check patterns.

## 7a. Calls made after the builder review (my calls, for the owner to check)

- **How money is held (owner decision):** Stripe holds the money and releases it when the criteria are met. How that is built is left to the builder, whichever Stripe allows for the whole held period and the lawyer accepts: charge in full when the customer pays and keep the funds in the platform's Stripe balance until a separate transfer (Stripe Connect "separate charges and transfers"), or destination charges with delayed payouts. An authorise-and-capture hold is not enough, because it lasts only about 7 days. The held period runs from payment to the release (up to about 7 days after "Finished"), plus up to 14 working days if disputed.
- **"Finished" and silence:** "Finished" becomes available from the agreed start time. The customer's 7-day confirmation window and reminders run from the moment the provider taps it (owner decision, section 3.5). Still my call, because the owner's answer covered only the case where the provider has tapped "Finished": if the provider has not tapped it 24 hours after the agreed end time, the customer is asked "Was the job done?" and can confirm it themselves or report a problem (a provider no-show is reported this way and refunded in full); if nobody acts within 7 days after the end time, the booking goes to staff and the money stays frozen.
- **Stop job:** the provider states the amount earned (hours times the rate, or a percentage for fixed-price work) and the customer accepts or disputes it. Staff decide a disputed one with a free-form amount, defaulting to the provider's statement for hourly work.
- **Commission:** the percentage is stored on each booking line at the moment of payment, so a later change never alters old bookings. It is a single global constant until the owner decides the rate. The commission is paid to KANDO automatically at the same moment the payment is released to the provider (customer confirmation, or the 7 days passing), and a stopped or refunded job pays commission only on the amount actually paid out (my call).
- **Additional task:** it is a separate booking linked to the original, with its own payment, "Finished" clock, payout and dispute state. The original and the additional task are refunded and paid out independently.
- **Time model:** a provider needs 30 minutes free between two on-site bookings (owner decision): two on-site bookings conflict when their time ranges, each widened by 30 minutes at both ends, overlap. "Works remotely" on a provider (owner decision, 29 October 2026) means they work on-site and remotely, so each booking records whether this job is on-site or remote: the customer chooses when proposing the time (a provider that does not work remotely is always on-site) and the provider can change it when proposing another time. Remote bookings get no buffer and need no job address; they conflict only when their time ranges overlap (my call). The buffer is one constant in one place. All times are stored in UTC and the 24-hour, 6-hour and 48-hour rules use the start time; the display zone is a per-country constant (Europe/Berlin for now).
- **What already exists (for the plan):** providers, services with price types (fixed, hourly, from, on request), documents, email through Resend, and in-app notifications exist. Stripe, Inngest, push notifications and realtime chat are not built.

## 8. Changes against the foundation design

Payment is taken when the customer pays after acceptance, not at confirmation; deposits stay out; direct booking is accepted by the provider and then paid (no 24-hour lapse rule beyond the new payment window); the customer has 7 days after "Finished" to confirm or dispute (as in the foundation design) with reminders after 1, 3 and 6 days, and silence releases the payment after those 7 days; review visibility is 7 days; a "Stop job" path, "Additional task" and chat contact blocking at every stage (contact details never shared) and the notice after three ignored requests are new; late customer cancellation is charged (50%, my guess).

## 9. To clear before building or promising these in any text

Listed in the README ("Legal points to clear with a lawyer"): holding the customer's money until the job is done; the 14-day right of withdrawal against cancellation fees; the cancellation terms; staff dispute decisions and consumer dispute resolution; review rules. Also to add: sending chat messages to an AI provider (EU provider, processing agreement, privacy notice), and whether "Zahlungsschutz" is acceptable wording.

## 9a. Order of work (owner decisions, my wording)

Payments, refunds and payouts are built behind an off switch and tested with Stripe test payments only. Real money is switched on only after the legal points in section 9 are cleared. The chat contact check ships with rules first; before the AI layer is added an EU provider must be chosen and a data processing agreement signed (README, step 19, covers the same choice for document checks).

## 10. Later (after the first release)

In-app calling with masked numbers (if on-site providers cannot reach customers); deposits; recurring bookings; weekly opening hours or a slot picker; per-category cancellation rules; AI helpers (suggest free times, draft the nudge message); numbers inside photos in the chat check.
