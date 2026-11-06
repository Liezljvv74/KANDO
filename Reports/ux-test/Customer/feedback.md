# Customer feedback: final (test agent "Customer", customer only)

Scope: one customer (Customer Tester, Torstrasse 100, 10115 Berlin) over 10 turns. Providers: All T. (Gardening, Cleaning, Assembly) and AllMore T. (Photography, Dog walking, Moving). Viewport 390x844, English UI throughout (German texts were not checked by me; the receipt and quote PDFs are bilingual German/English).

## Where things stand (end of test)

| Job | What | Booking / request id | Status shown now |
|---|---|---|---|
| J1 | Gardening, All T., EUR 84 | booking ff0239dc-71d7-4143-9221-da5b3b57a2de, request 578b9dad-4773-45da-bebf-84cdc25b95b5 | "Payment pending: it is being processed." |
| J2 | Photography, AllMore T., EUR 120 | booking 33b3bd4f-4dd4-4368-b821-8b16b47ef0a2, request a9d58011-49ef-4b34-b3a9-6986826366d9 | "Payment pending: it is being processed." |
| J2 extra | 10 more photos + 2 prints, EUR 45 | booking 3a01258d-c663-4062-aa51-b2235b537445, request d1fcaa1f-6f7d-492f-8c60-fb6e6f710ac1 | "Payment pending: it is being processed." |
| J5 | Cleaning, All T., EUR 85 | booking 527499cb-3eff-49cf-9a13-53da2cafd2cb, request 9dec8060-faf8-4591-8c34-ba6600653102 | "You cancelled in time. You get the full price back; this can take a few days." |
| J6 | Dog walk, AllMore T., EUR 20 | booking c8747afb-c36e-47df-83c4-5a5d6a945474, request c2bcca55-8585-42ac-a5dd-4f7b9a54d899 | "Completed"; receipt TEST-3A792693-2026-0001; my review (5 stars) saved |

Notes from the last check: J1, J2 and the extra show "Payment pending" with no review block. The J5 page does not say whether the refund has arrived. A new Home/Bookings banner now says "A review of your job is now visible." and "Your invoice or receipt is ready. You can download it in the app." (not tied to a booking name). Test-environment payment issue (other sites refunded test payments) is known and not an app finding.

## 1. How the flow of tasks felt
- The four tabs (Home, Search, Correspondence, Account) are easy to understand. Searching for a provider, opening a profile and sending a request is quick once you are on the right screen.
- Where I got stuck: finding my own customer details (they are under Account > "My data"); finding old things later (requests, chats, quotes, receipts live in four different places, none linked); understanding what "Book" commits to; and what "Payment pending" means for my money.
- I always knew the next button on the request, quote and confirm screens. I did not always know what the app would do next after a button (see section 3).

## 2. What was difficult to navigate
- Category sheet in Search: Gardening was below the fold; typing in its search box was the only reliable way.
- Date and time fields: the date of birth field accepted only the ISO format (1985-06-14). I typed 14.06.1985, pressed Save, the app said "Saved" and the field came back empty. Request forms: Date only accepts ISO, Time of day is free text.
- Stripe card section: the card row sits under its own button, so a normal click does not open it.
- Requests, Messages and Bookings lists: titles are the full request text, or just a provider name. Two threads were both named "All T."; four Messages rows read "AllMore T., AllMore T., All T., All T.".
- Booking pages change a lot after each step (date changes, buttons change) with no explanation.

## 3. Ratings per flow (1 = very hard, 5 = effortless)

| Flow | Rating | Why |
|---|---|---|
| Sign-up and verification | 4 | Short form, clear code screen ("Check your email / We sent a 6-digit code..."). Minus: the Home banner "Add your picture so providers can recognise you" stayed after I had picked a photo. |
| Customer profile set-up | 3 | Date of birth trap (only ISO accepted; "Saved" shown, field emptied). The AI sentence above the form ("An AI service reads the photo once to suggest your name...") is long and confusing for a simple form. |
| Finding a provider | 3 | Filters work, but the category sheet is hard to scroll. A filtered list dropped Jürgen M. (Gardening, EUR 35) with no explanation. |
| Opening a provider profile | 4 | Strengths, skills, experience, "Checked documents: Photo ID" and the price per service are easy to read. |
| Requesting a job (request form) | 3 | Clear fields and "Answer by" date. Minus: ISO-only date, free-text time, "Photos for the provider" sheet titled "Profile picture", about 8 to 15 s spinner on "Send request". |
| "Book" versus "Request a quote" | 2 | "Book" on fixed-price services (Cleaning EUR 85, Dog walks EUR 20) opens the same "Request a quote" form, with no price shown, and says "The provider answers with a quote". Not clear what I committed to. |
| Chat | 4 | Easy to open from the request ("Open chat") and to write in. Minus: no chat before a request exists (no "Ask a question" on the profile), the chat does not link back to the request, booking, quote or invoice, and it does not say when the provider has read the message. |
| Quote (reading it) | 3 | Quotes show as banners and a Correspondence badge, which works. Minus: "No service named" on the Photography quote card, accept dialog and booking; J1 quote "valid until" is the job day, not 7 days; J2 quote said "20 edited photos" when I asked for 30 to 40, and there is no way to ask for a change; the helper text "To change something, talk to the provider in the chat" is good but easy to miss. |
| Accept and pay | 3 | Accept is one tap (sometimes a "Yes, accept" dialog, sometimes none; inconsistent). Stripe opens in a new tab; the card row needs a workaround; no postcode field for Germany; the return page says "Back to the app", which is a skilled:// link that does nothing in a browser. Payment itself worked (booking changed to "Paid and confirmed"). |
| Additional task | 4 for starting it, 2 for seeing it with the original | Start is clear (4 taps, "What else should be done?", "Start the additional task", "Sent. You find the new request under Requests..."). But the extra is a separate Requests item titled with its full text, its detail page does not show the parent booking, the J2 booking still shows only EUR 120, and the chat shows "Additional task requested" with no link. |
| Cancel and refund | 3 | Before paying the button is "I no longer need this". After paying it is "Cancel the booking" with a clear rule: "Cancelling now is free. You get the full price back; this can take a few days. Paid additional tasks of this booking are cancelled with it, by the same rule." Minus: no result after "Yes, cancel" until a reload, no line saying the provider was told, and no line saying whether the refund arrived. The J5 page still says only "this can take a few days". |
| Waiting for a payment ("Payment pending: it is being processed.") | 1 | J1, J2 and the extra have shown this since I confirmed them. Nothing else on the page: no explanation, no expected time, no retry, no support link, and the status buttons are gone. A customer would worry the money has gone nowhere. What I would expect: "We are processing your payment. This usually takes X days. If nothing changes by [date], contact support" plus a support link and an explicit message if it fails. |
| Confirming the job | 4 | "Confirm the job was done" -> "Confirm the job was done? The payment to the provider is then released." -> "Yes, it was done". Clear. Result "Completed" at once (J6). Minus: the Home banner "marked the job as finished" stayed after I had confirmed J1. |
| Review | 4 | J6: a Review block appears under the receipt once the booking is Completed: five star radios, "A few words (optional)", "Send review". After sending: "Your review", five stars, my text, "The other side sees it from Nov 13, 2026, 3:19 PM, or as soon as their review is in." and "You can change it until Nov 13, 2026, 3:19 PM." Clear. Minus: nobody tells you the review block exists (no banner, no button); I found it by scrolling. The rule "The other side sees your review once both are in, or 7 days after the job." is good wording. J1 and J2 show no review block while payment is pending. |
| Receipt and quote documents | 3 | Bilingual German/English PDFs: provider name and Berlin postcode, customer address, service text, labour and material, total, "Dies ist ein Angebot, keine Rechnung (This is a quote, not an invoice)" on the quote. Missing: VAT (or small-business) wording, any platform fee or commission line, provider street address, invoice number linked to the booking, payment method, the job date (the receipt shows the confirmation date). |
| Invoices and receipts list | 1 | One row only: "Receipt TEST-3A792693-2026-0001, From AllMore Tester, Nov 6, 2026 · €20.00". No search, filter, sort or grouping by provider, date, amount or job. Rows open the PDF directly; nothing links to the booking, quote or chat. |
| Finding old things (one job later) | 1 | There is no single place for a job. From the receipt you cannot reach the booking, quote or chat. From the chat you cannot reach the receipt. Bookings rows are identical ("Payment pending: it is being processed.", Nov 6 10:56 AM). |
| Notifications | 3 | Home banners and the Correspondence badge are the only signal, and they are good. Minus: banners do not name the booking ("A quote is ready for your request"); they stay after the action is done ("marked the job as finished" after confirming); "+16 more messages" hides which job. No push here, so I cannot judge push, email or in-app parity. |
| Account and settings | 4 | Account shows email, language, "My data", "I want to provide a service" switch, two notification switches (Chat messages, Reminders), "Delete my account", "Export as JSON / CSV". Clear. |
| German texts | not checked | I used English throughout. The PDFs are German-first, bilingual. |

Efficiency score summary: sign-up 4, profile 3, finding a provider 3, request 3, quote 3, accept and pay 3, additional task 4 (start) / 2 (overview), cancel and refund 3, waiting for a payment 1, confirming 4, review 4, receipts and quotes 3, invoice list 1, finding old things 1, notifications 3, account 4.

## 4. Concrete suggestions

Fewer taps and fewer surprises:
- Let me pick my date from a calendar and a time from a slot list on the request form. Fix the date of birth field (accept any sensible date entry, or use a native date picker that shows the value after Save).
- Show the price on every "Book" button and on its form. If it is a fixed price, say "You book directly: EUR 85 fixed" and do not say "the provider answers with a quote". If not, label the button "Request a quote".
- Make the category filter a dropdown with search, or show the chosen category in the list header.
- One Confirm dialog for every "Accept" (currently sometimes one, sometimes none).
- Clear the Home banner once I have acted on it.

Extra buttons that would remove explanation:
- "Ask a question" on every provider profile (a pre-request chat).
- "Ask for a change" on each quote (sends a message with the quote attached, the provider replies with a revised quote, which I confirm).
- "Leave a review" on the booking (and a banner "Leave a review for AllMore" when the job is completed).
- "Contact support" on any booking that is waiting for a payment.
- "Download receipt" and "Print" on the receipt page, and "Share" (share sheet).

Nothing that needs explanation:
- After each action, the booking should show what happens next in one sentence, for example after payment: "Paid. The provider will start on Sun 8 Nov 10:00. Mark the job finished when it is done."
- Keep the agreed date and time on the booking. Show "Started at" as a separate line.
- Replace the status "Payment pending: it is being processed." with a timed explanation and a next step (see section 3).
- The cancel result should show "You cancelled. All has been told. Your refund of EUR 84.00 is on its way (usually 3 to 5 days)."
- Replace skilled://bookings with a web link ("Back to KANDO") on the Stripe return page.

## 5. How communication should be improved
- Each message, quote, invoice and receipt should carry the job reference and the service name ("Gardening - All T. - Wed 11 Nov 10:00 - booking ff0239dc").
- The chat should show system entries as links ("Quote EUR 84.00 (version 1)" opens the quote; "Additional task requested" opens the extra).
- "Read" receipts: show "All has read your message" under my message, or at least "Sent".
- Replies should appear as a banner that names the job, not "You have a new message."
- Notices should be shown once and cleared when acted on, and should say which job they are about.

## 6. Proposal: how messages, quotes, invoices and receipts should be stored and found

One job page per booking (the "job" is the unit a customer thinks in). It contains:
1. Header: service, provider (name, photo, verified badge), date and time, place, job reference, status in plain words ("Waiting for payment", "Booked", "Work finished, please confirm", "Completed", "Cancelled, refund on its way").
2. Timeline: "Requested 6 Nov 13:23 - Quote EUR 84 received 6 Nov 13:29 - Quote accepted 6 Nov 13:39 - Paid 6 Nov 13:40 - Work marked finished - Confirmed - Receipt issued".
3. Request: the text I wrote, photos, the answer-by date.
4. Chat: the whole conversation for this job (one thread), with quote, change and receipt entries as links.
5. Quotes: every quote for this job, with its number, amount, validity and PDF. Old versions stay visible.
6. Additional tasks: each extra with its own quote and payment, plus a total ("Original EUR 120 + extra EUR 45 = EUR 165; paid EUR 0 so far").
7. Payments: each payment with amount, date, method, status and a plain-words explanation.
8. Documents: quote PDF, receipt PDF (and invoice PDF once VAT rules apply), each with number and date, plus Download, Print and Share.
9. Review: my review (edit until the date), and the provider's review once it shows.
10. Help: "Contact support" with the job reference pre-filled.

Finding things later:
- Global search (one box at the top of Correspondence) by provider name, service, job reference, invoice or receipt number, or any word in the chat.
- Filters on Invoices and Bookings: date range, provider, service, amount range, status (paid, pending, completed, cancelled).
- Sort by date (newest first) with the job reference and service name on every row.
- A "Documents" tab listing all quotes, receipts and invoices, each row linking back to its job page.
- Each PDF footer carries the job reference and a link to the job page (QR code on paper).

## 7. Extra feedback (trust, safety, wording, accessibility, empty states, errors, onboarding)
- Trust: the review rule text is good ("The other side sees your review once both are in, or 7 days after the job"). Keep showing the provider's verified badge and "Checked documents: Photo ID" on the profile. Show when the provider last responded.
- Safety: nothing told me how to report a problem during the job except "Report a problem" after the provider finished. A short line on the booking ("Something wrong? Report it here") would help, especially for a dog walk or a visit to my home.
- Wording: "Stop the job", "The other side did not turn up", "Work on the additional task starts only once it is accepted and paid", "Payment pending: it is being processed" need a sentence of plain explanation under them. "Profile picture" is used for a job photo. "No service named" should never appear. "Dies ist ein Angebot, keine Rechnung" is good. The date "Valid until Nov 8, 10:00 AM" equals the walk time, which reads like a mistake.
- Accessibility: the stars are radio buttons labelled "1 star" to "5 stars" (good). The card number, expiry and CVC on Stripe are inside an iframe that needed a workaround for me (a keyboard user would struggle too). The Correspondence badge number should be read out.
- Empty states: "You have no invoices or receipts yet. They appear here once a booking is settled." and "You have no quotes yet. They appear here once a quote was sent or received." are clear. Add a line for when they will appear ("after the job is done and paid") and a link to my open bookings.
- Error states: none shown to me during the test (no error message for a failed payment, a failed send or an expired quote). Each needs a message with the next step.
- Onboarding: the first screen after sign-up asks for a picture again. Show a short first-time guide: "Find a helper, ask for a quote, pay in the app, confirm the job, leave a review."
- Visual: the booking heading is the most important element and is good. The buttons below it change a lot ("Cancel the booking", then "Stop the job"), which makes the page feel unstable.

## Turn-by-turn facts (kept from earlier sections, condensed)
- Sign-up: code 414134 accepted after resume; Home then shows banners for quotes, messages and finished work.
- Profile: Torstrasse 100, 10115 Berlin, date of birth 1985-06-14 (ISO only), saved.
- J1: request sent 6 Nov (hedge, 11 Nov 10:00, 3 h); All answered in chat (1:29 PM); quote EUR 84; accepted and paid; marked finished; I confirmed; payment pending.
- J2: request sent (family portrait, 14 Nov 14:00); AllMore answered in chat (20 photos, extra session priced separately); quote EUR 120 accepted (I had not negotiated; the quote text already said 20); paid; marked finished; I confirmed; payment pending. Extra task (10 photos + 2 prints) requested; quote EUR 45 accepted and paid; marked finished; confirmed; payment pending.
- J5: cleaning request 17 Nov 09:00 (EUR 85 fixed); accepted and paid; cancelled by me. Page: "You cancelled in time. You get the full price back; this can take a few days."
- J6: dog walk request 8 Nov 10:00 (45 min, EUR 20); quote accepted and paid; marked finished; I confirmed (Completed); review 5 stars "Bruno was happy, quiet route, on time."; receipt TEST-3A792693-2026-0001 downloaded.

## Files
- This file: C:\Users\Liezl\Documents\APPS FOR BUSINESS\KANDO\Reports\ux-test\Customer\feedback.md
- Diary (per step, with taps and quotes): C:\Users\Liezl\Documents\APPS FOR BUSINESS\KANDO\Reports\ux-test\Customer\diary.md
- Screenshots: C:\Users\Liezl\Documents\APPS FOR BUSINESS\KANDO\Reports\ux-test\Customer\stripe-card-step.png and stripe-card-step-j2.png
- Downloaded PDFs: C:\Users\Liezl\Documents\APPS FOR BUSINESS\KANDO\.playwright-mcp\TEST-3A792693-2026-0001.pdf (receipt) and C:\Users\Liezl\Documents\APPS FOR BUSINESS\KANDO\.playwright-mcp\TEST-Q-3A792693-2026-0003.pdf (quote)
