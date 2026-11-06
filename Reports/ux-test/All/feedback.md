# Final feedback: All (customer and provider)

Tester: All (liezljvv74+all@gmail.com). Used the app as a real user at 390x844, with a test setup (fake pickers, test Stripe, moved dates). Detailed steps and tap counts are in `diary.md` in this folder. Quotes below are the exact texts on screen.

## 1. How did you experience the flow of tasks; was it easy to navigate; did you know where to go to get things done?

- **Provider set-up was reachable but not obvious.** The path that works is My business (tab) > "Let's set up your service profile" > About you / Add service / Verification documents / Set up payouts. A new provider does not get told the order of these steps, and the progress bar only says "Let's set up your service profile".
- **Some steps only appear by accident.** "Set up payouts" showed once (after I tapped "I offer my skills" on Home) and then disappeared for several visits. It came back later. A real provider would not find it. Availability (opening times) was not anywhere.
- **Customer and provider share one login and one tab bar.** Home, Search, Correspondence, My business, Account. The customer path starts from the "I need help" card, the provider path from "I offer my skills" or My business. Nothing on screen says which role is active.
- **The "Live" state gave no reason.** For three test rounds the switch stayed disabled with "Fill in the fields marked * below to go live." The fields marked * looked filled. The cause was the default "Private person or business" in Provider type, which looked selected but was never saved. The screen should show "Choose your provider type" (no default) or save the default when it is shown.
- **Correspondence is the real inbox.** Requests, quotes, messages and invoices are four rows that each open a separate list. Home carries the in-app notices.
- **Once I was inside a booking or request, the next step was clear** (Open chat, Send a quote, Confirm quote, Pay now, Job finished, Report a problem).

## 2. What was difficult to navigate?

1. Provider type default and the Live switch (see 1). Biggest blocker of the whole test.
2. "Set up payouts" disappearing and reappearing (about 2 visits needed; the second visit showed "Review and confirm" with a Confirm button after the first one said "Almost done").
3. Stripe onboarding: "Not a valid URL" for example.com; a product description was needed instead; "Personal details: Incomplete" blocked "Agree and submit" until an ID verification step was done (test "Simulate").
4. Role switching in Correspondence: the "My requests and bookings" screen opens on "As customer" (empty), and "As provider" is one more tap away. Provider banners ("You have a new request ...") appear on the customer list too.
5. Booking pages do not show whether the money has moved: "Payment pending: it is being processed." and "Being reviewed by our team" stay on screen after the decision.
6. Login and first load: about 10 to 12 seconds with a spinner each time.
7. Hard reloads of /my-profile redirected to Home, so I always used the tab bar.
8. The bottom tab bar blocks taps on buttons that sit low on the page (for example "Add picture", "I offer my skills" card).

## 3. Rate each flow for efficiency (1 to 5) with reasons

| Flow | Rating | Reasons |
|---|---|---|
| Sign-up and verification | 3 | The 6-digit code screen is quick (1 field, 1 tap, straight to My business). But the Terms checkbox needed 4 taps; a tap on the Terms text opened a new tab; "Profile picture" gave no feedback; first load is slow. |
| Profile (About you, My data) | 3 | Fields are clear and save on Back ("Strengths: 2" shows). Date of birth rejected "14.03.1988" silently (only ISO worked). No save button on About. |
| Provider type / Live | 2 | Default looked chosen but was not saved; Live stayed disabled with no reason. Once set (2 options tapped), Live enabled in one tap. |
| Services (add, price) | 4 | Category sheet, description, price type, price: 6 taps per service. Each card shows "Document needed: Photo ID (ID card or passport)" which is useful. |
| Documents (Photo ID) | 2 | Upload gave "Something went wrong on our side or on the way, and nothing was lost. Please try again; write to info@skillweb.space if it keeps happening." twice. Later showed "Approved" after staff review, with no notice. |
| Profile photo | 1 | The sheet (Camera / Choose photo / Remove picture) is clear, but the upload failed twice with the same message. Photo never saved. |
| Payout (Stripe) | 2 | Long hosted onboarding (about 40 taps, 11 Stripe screens, 2 visits). The app did not update until a second visit ("Continue payout set-up"). Final text: "Your payouts are set up." |
| Tax number and invoice consent | 4 | Help text explains who needs it ("Kleinunternehmer ..."). Switch "The platform issues invoices ... in my name." is one tap. |
| Availability | 1 | Not found anywhere (My business, About you, service edit, Account, Stripe). |
| Going live | 2 | One tap once everything is set ("Your profile is live. Tell people about it." and "Published: visible to customers"), but the blocking reason was never shown. |
| Finding providers (Search) | 4 | Category, postcode, search term, Find. Cards show "New", services and "from €…". |
| Request (customer) | 4 | Form (what, date, time, duration, address prefilled, note) is short. Address prefilled from the profile. |
| Quote (provider) | 3 | Amount, scope, "Date and time confirmed", date, time, duration, Send. Fast (1 tap). But validity "Open · Valid until Nov 13, 2026, 1:31 PM" is not explained, and the date has no weekday (I wrote "Friday" for a Tuesday). |
| Chat | 3 | Simple. Send stays disabled until text is typed. Empty state "No messages yet. Write the first one." Messages have time stamps. Missing: a clear "new message" link from the banner to the right thread. |
| Accept and pay (customer) | 3 | "Confirm quote" > "Waiting for your payment, pay by ..." > "Pay now" (new tab, Stripe Checkout). Card fields sat behind the accordion (needed a second tap on "Card"). Return page says "being confirmed now": booking only showed "Paid and confirmed" after a reload. |
| Additional task | not done | I did not add an additional task. The sheet said "Work on the additional task starts only once it is accepted and paid. Until then, only the original job is owed." I did not test it. |
| Decline (provider) | 2 | "Decline request" > "Decline this request? The customer is told." with Cancel / Decline request. No reason choice. I wrote the reason in chat first. Status then "Declined". |
| Role switching | 2 | No indicator of the active role. Provider banners appear on the customer list. |
| Notifications | 3 | In-app banners at the top of Home with "Open" and "×", plus a count badge on Correspondence. "+15 more messages" gives no names. No push (as expected here). One decision notice stayed stale ("A problem was reported ... nothing is paid out until it decides"). |
| Finishing a job (provider) | 4 | "Job finished" > sheet with "The customer then has 7 days to confirm or report a problem. Without an answer the payment is released after the 7 days." > "Mark as finished". Clear release date afterwards. |
| Earnings / payout visibility (provider) | 1 | No earnings screen found. Only "Payment pending: it is being processed." and the release date on the booking. |
| Dispute (customer) | 3 | "Report a problem" > "Describe it calmly and factually. Our team reads it and decides within 14 working days. No money moves until then." > "What went wrong?" > "Send the report". Clear rules before sending. No photo field. After sending: "Being reviewed by our team". |
| Dispute decision (customer) | 3 | "Decided: the provider is paid €35.00; the rest goes back to the customer." with a reason. But the heading still said "Being reviewed"; no appeal, no deadline for appeal, no reference number, no date for the money. |
| Invoices | 2 | "You have no invoices or receipts yet. They appear here once a booking is settled." Could not check a real invoice. CSV export is on My business. |
| Reviews | 1 | No review control found on a finished booking or after the dispute decision. |
| Account | 3 | My data saves (Save > "Saved"). AI disclosure text is shown ("An AI service reads the photo once ..."). Notification switches. "Delete my account" and "Admin panel (test version only)" sit close together. |

## 4. Concrete suggestions

Fewer taps:
- Ask for "Provider type" in a first-run wizard (one screen, no default). Save on tap.
- Let the Live switch show the reason as a list: "Missing: Provider type, Profile photo, Availability." Each item links to its screen.
- Combine "Add picture" and "Change profile photo" into one entry point with the same sheet.
- Terms checkbox: make the whole line tappable as one control. Do not open the Terms link on a tap of the sentence.
- Stripe: pre-check business type "Privatperson" and skip the website step when the product description is used (already offered; make it the default for individuals).
- Accept a German date format (14.03.1988) in the date field.
- Provider decline: add a reason list ("Fully booked", "Not my service", "Outside my area", "Other") with a free-text field. The customer sees the reason text.
- Booking page: put the next action first and label it in one line ("Next: Mark as finished after the job"). Add a timeline (requested, quoted, paid, finished, released).

Extra buttons:
- A "Your next step" card on Home per open booking, with one primary button.
- On a finished booking (provider): "Earnings" line with amount and release date.
- On a dispute decision: "Appeal" button (with deadline) and "Write a review" button.
- Role toggle at the top of Correspondence: "Customer | Provider" with the active role highlighted. Banners carry the role name ("As provider: new request ...").

No explanation needed:
- Show weekdays next to dates everywhere ("Tue 17 Nov, 09:00").
- Name the money on banners ("A booking was cancelled: €85.00 refunded in full." or "...€85.00, refund pending").
- Show the quote validity as "Quote valid until Tue 13 Nov, 10:00" and say what happens when it runs out.

## 5. How can communication be improved?

- Banners should name the job and the person: "AllMore T. sent a quote: €70.00 for Fri 13 Nov, 10:00." Tapping opens that booking, not the list.
- Push is not available in this test, but the in-app banner should stay until the thing it announces is done (for example a decision), and should update when the state changes. Right now a decision left the old banner text on Home.
- Chat: after a quote is sent, post a system line in the chat ("Quote sent: €84.00, valid until ..."). After payment and finish, the same. The chat is then the single log of the job.
- Customer side: say what the provider will receive and when, in the same words used for the provider side.
- Give every message a visible time and sender role ("Customer" or "Provider") so a second account does not get confused.
- Reply expectations: the request says "Answer by Nov 9, 2026" (3 days). Show a countdown on the request card.

## 6. How should communication (messages, quotes, invoices) be stored so it is easy to refer back to and find specific communication, quotes or invoices?

Proposed structure (one record per job):

1. **Job record** with a stable ID (booking or request ID) and a short human reference, for example `KD-2026-000123`. Shown on every screen, every e-mail and every invoice. Quote numbers already exist in the app (TEST-Q-...); keep them and add the job reference.
2. **Timeline inside the job**: request, chat messages, quotes (version 1, 2, ...), confirmation, payment, finish, dispute, decision, money released. Each entry has a date and time, the actor (Customer or Provider) and a link to the detail.
3. **Quotes tab** on the job: each quote with amount, scope, validity, status (Sent, Accepted, Expired, Replaced) and the chat message that carried it.
4. **Invoices tab** on the job and a global list under Correspondence > Invoices: invoice number, date, job reference, amount, VAT, tax number used, PDF download.
5. **Search** in Correspondence: by job reference, person name, date range, status, amount. Filters "Open", "Waiting for payment", "Finished", "Disputed", "Closed".
6. **Chat search**: search inside a job's chat. Attachments (photos) listed in a tab in the job.
7. **Export**: "Download job record (PDF)" with the timeline, quotes, invoices and chat. It is useful for customers and for dispute decisions.

## 7. Additional feedback (wording, trust, safety, accessibility, German/English, visual design, empty states, error messages, waiting states)

Wording:
- "Something went wrong on our side or on the way, and nothing was lost. Please try again; write to info@skillweb.space if it keeps happening." Good that it says nothing was lost. Bad: no next step other than "try again", and the file size or type is not mentioned.
- "Valid until Nov 13, 2026, 1:31 PM" needs "Quote valid until". "Suggested time" is unclear: say "Date you proposed".
- "Being reviewed by our team" stayed after the decision. Use the decision as the heading.
- "Payment pending: it is being processed." does not say how long, or who to ask.
- "Fill in the fields marked * below to go live." should say which field.
- "Share" next to the Live switch did nothing visible in this browser. Say what it does ("Copy link" or the phone share sheet).

Trust and safety:
- Public profile shows "Verified" and "Checked documents: Photo ID, Permit". Good, but "Verified" appeared without any notice to the provider. Tell the provider when a badge is shown.
- The AI disclosure in My data is clear ("An AI service reads the photo once ... The photo is not saved ...").
- After booking, the full street ("Torstrasse 100") appears to the provider. Before booking only the postcode shows. That is right, but say when the address is revealed.

German and English:
- The whole test ran in English. Several strings mix German-style structure and English ("Kleinunternehmer" help text, "Privatperson" in Stripe). Check every screen in German (main language). Weekday names and "Valid until" need proper German translation.

Accessibility:
- Small tap targets on the tab bar and on the accordion (card row). The bottom tab bar covered buttons near the bottom of longer pages.
- Several controls are switches without a visible text state (the Live switch is a grey dot when disabled).

Visual design and states:
- Empty states are short and clear ("No conversations yet.", "Nothing here yet."). Add one line of guidance and a button ("Find providers").
- Loading states: long spinners on login and My business (10 to 12 seconds). Show the cached profile first.
- Duplicate notices: the same banners appear on Home and on Correspondence.

Test-setup notes (not product issues, for the coordinator): fake file pickers, test Stripe, moved dates, a payments switch that was off for a while.

Overall: the core marketplace path works end to end (request, chat, quote, pay in Stripe test, finish, dispute, decision). The biggest problems are hidden blockers (provider type, payout, availability), missing role clarity, and missing next-step guidance after the money side.
