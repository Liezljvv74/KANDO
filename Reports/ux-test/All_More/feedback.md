# All_More final feedback (customer and provider)

Tester: All_More (liezljvv74+allmore@gmail.com, AllMore Tester, Berlin 10119). One account, used as provider (services, quotes, jobs J2, J3, J6) and as customer (request J4 to All, declined). Based on the diary in Reports/ux-test/All_More/diary.md (steps 1 to 56). Ratings: 1 = very poor, 5 = very good.

## 1. How did the flow of tasks feel, was it easy to navigate, did you know where to go?

Mostly yes, once I was in. The core cycle works end to end: request, chat, quote, accept, pay, finish, review, receipt. The bottom bar (Home, Search, Correspondence, My business, Account) is simple, and the status words on a booking ("Paid and confirmed", "Job finished", "Completed", "Under review") are plain.

The hard part is knowing *what I have to do next*. Home is a list of notification cards that do not name the job and stay on screen after I have acted. The Correspondence tab has a badge, but its number does not match the number of cards. I always had to go into Correspondence > My requests and bookings > As provider > Bookings/Requests and then open each row to find out what was waiting. I also did not know where to start on Home: it shows two big intent buttons ("I need help", "I offer my skills") and a list of news, but nothing like "3 things to do today".

Going live and getting paid were the places where I was least sure where to go (see 2 and 3).

## 2. What was difficult to navigate?

- Provider set-up: I only found the Save step by accident (Back saves). "Add strength" and "Add skill" stay disabled until you type, and the chips only commit when you leave the field.
- "Live" stayed disabled with the text "Fill in the fields marked * below to go live.", but nothing was marked. The cause was "Provider type *", which displayed "Private person or business" but was never really selected. Only an explicit tap on "Private" enabled Live. Rating for this: 2.
- Documents: the required-documents counter kept saying "(0/2)" while both were "Waiting for check". Approval came silently (no banner, no notification I could find); I only noticed when I reopened the page.
- Payout (Stripe): the phone verification code "000000" was rejected ("Incorrect verification code.") for several numbers. It only worked after "Use test phone number" on the phone screen, then Stripe showed "Use the code 000000 to successfully continue" with a "Use test code" button. The Stripe page is titled "EfficientLife sandbox", which a real provider would not recognise as KANDO. The date of birth is three boxes (day / month / year), while the app asks for it in another format. The payout step ended on a page of the website ("Almost done ... Back to the app").
- Bookings list: two rows with the same time, "Paid and confirmed", and no job title. I had to open the first one to find the van job.
- Role switching: one login, two modes, with no visible switch. In provider mode the Search screen shows my own "My service profile" card under the results; in customer mode it does not. The bottom bar looks identical in both modes. Right after login the tab bar sometimes showed only four tabs and no badges for a few seconds, which looked like the provider side had vanished.
- Money: there is no screen that tells me what I will receive (see 3).
- Dispute: the provider can see the customer's report (good) but can only reply in the chat, which is not linked to the report (see 5).

## 3. Rate each flow for efficiency (1 to 5) with reasons

| Flow | Rating | Reason |
|---|---|---|
| Sign-up and verification | 4 | Short and clear. The "I offer a service" box was already ticked because the welcome button adds ?offer=1; I did not know that from the screen. The 6-digit code step worked first time. |
| Profile set-up (About you, service area, personal data) | 3 | Many fields, few explanations. No Save button on About you (saves on Back). Service area is not its own screen; it is postcode + radius inside About you. Personal data (Account > My data) has a clear Save with "Saved". |
| Provider type / Live switch | 2 | Default value looks chosen but is not; Live stays disabled with no pointer to the field. Went live only after an explicit tap. |
| Services (add, price types) | 3 | Category, title, description, price type, price. Sheets open and close well. Title I type does not show on My business (the category name shows), but it does show on the public profile. Dog walking adds a "Permit from the local authority" requirement only after choosing the category. |
| Documents | 3 | Upload is simple (Add > Choose from gallery). Status "Waiting for check" is clear. Approval is silent; counters lag. |
| Payout via Stripe | 2 | About 45 taps including a phone-code failure that needed a hidden test-number route; English-only Stripe pages inside a German-capable app; Stripe business name "EfficientLife sandbox". Once done: "Your payouts are set up." is clear. |
| Going live | 2 | See the Live/provider-type trap above. |
| Finding providers (Search) | 3 | Category and postcode filter work. The "from" price changed between an unfiltered and a filtered search (EUR 28 vs EUR 85 for the same provider) without explanation. Distance "≈ 1 km" appears only after a search. |
| Request (customer) | 3 | Clear form. Price is not shown on the form (it is shown on the provider page); the form says "A quote is valid for 7 days". The quote from the provider was valid only until the job start. |
| Quote (provider) | 3 | Amount, scope, date/time switch, duration. Clear. Validity ends at the job start (e.g. "Valid until Nov 13, 2026, 10:00 AM"), no explanation and no field to change it. Form keeps my typed values after sending. |
| Chat | 3 | Simple and quick. Send button only enabled after typing. Quotes and accepted quotes appear as cards inside the chat, good. But the customer's dispute text is not in the chat, and the chat has no link to a booking or quote. |
| Accept and pay | 4 | I only saw the results: "Quote accepted: EUR 70.00" in chat and "A booking was paid. The appointment is confirmed." as a Home card. Clear wording. |
| Additional task (provider side) | 4 | The request is titled "Additional task for a booking" and says that work starts only once accepted and paid. The chat shows the original quote and the additional task together. Missing: a link to the original booking. |
| Decline (as customer, J4) | 3 | Outcome clear: "Abgelehnt" on the request, and the provider's chat message. No decline reason field, no alternative providers, and no message in the app itself. |
| Role switching | 2 | No clear switch on Home; roles are separated only by page content. |
| Notifications | 2 | Cards without the job name; cards stay after acting; badge counts differ from cards; no push (expected). Notification settings are on the Account page: Chat messages, Reminders. |
| Finishing (Job finished) | 4 | Clear text: "The customer then has 7 days to confirm or report a problem. Without an answer the payment is released after the 7 days." Optional material costs field. No prompt for receipts or photos. Material costs disappear after saving (not shown again). |
| Dispute (provider side, J3) | 3 | Clear status "Under review", the customer's full text, "Our team decides by Nov 26, 2026. No money moves until then." Later the screen showed the decision: "Entschieden: der Anbieter bekommt 35,00 €; der Rest geht an den Kunden zurück." followed by an English explanation (provider gets half). Good that the outcome is plain; bad that it is half German and half English, and that I could not see how I could respond beyond the chat. |
| Money visibility | 1 | No earnings total, no pending amount, no net after commission, no commission rate before accepting a job. The only money information is the release date after "Job finished". |
| Invoices and receipts | 2 | Receipt PDF: "Quittung (Receipt)", number, date, from/to, service text, labour 20,00 €, material 0,00 €, total 20,00 €, "Ausgestellt im Namen und für Rechnung von AllMore Tester durch KANDO". Missing: my tax number, any VAT or small-business (Kleinunternehmer) wording, commission, net amount, payout date. Commission invoices: "You have no commission invoices yet. KANDO sends you one each month in which it kept commission." (empty, as expected). |
| Reviews | 4 | Form: five stars, optional words, "Send review". The rule is printed on the form: "The other side sees your review once both are in, or 7 days after the job." Customer's review was visible straight away after both were in. The public profile now shows "★ 5 of 5 (number of reviews: 1)" and the review text. |
| Account | 3 | Language switch is easy (Account > Language, also on the login screen). Personal data, notification switches and "I want to provide a service" are in one place. Delete account and Admin link sit next to each other with no separation. |
| German | 3 | Most of the app is translated, but: mixed Sie/du (Home: "Beschreibe ... erhalte" next to "Schreib ... Du kannst"); "Nachweise" and "Dokumente" for the same thing; "Gassi-Service" for Dog walking and "Umzug & Entrümpelung" for Moving, while the category list says Dog walking / Moving; "Online" in one place and "Veröffentlicht: für Kunden sichtbar" in another; "Ort: Vor Ort: ..." (duplicate); "Buchungen" is the booking title, "Angebot" the quote, "Anfrage/Anfragen" the request, "Auftrag" the job, and all of them appear on one screen. Untranslated English text: customer chat and review texts (user content, acceptable), the dispute explanation, and some Account labels right after switching the language. Quittung (German) versus "Receipt" (English) on the booking. |

## 4. Concrete suggestions

Fewer taps / no explanation needed:
1. A "To do" block on Home, one line per open item with the job name and the next action: "Quote needed: Dog walk for Bruno, Sun 8 Nov 10:00 - Reply", "Finish: Van help for moves, Fri 13 Nov". Clear the card when the action is done.
2. Name the job on every notification card and badge ("New request: Dog walk for Bruno, Sun 8 Nov").
3. Show the role on screen: a visible switch at the top ("Customer / Provider") and the same header in every screen of that role. Hide the provider card in Search when in customer mode (already the case) and say which mode you are in.
4. Live switch: when disabled, highlight the field that is missing (not only the text). Make Provider type a real choice with no default text.
5. Documents: show "Approved" with a date when staff approve, and a notification for it.
6. Payout: one screen that lists the next steps in order and says "Stripe test: use 000000 (test number)" only in test mode, and link the Stripe page to KANDO's business name.
7. Quote form: show the price from the service and the rule ("valid until the job start" or "valid for 7 days"), with a field to change validity.
8. Booking list: show the service title and the customer name on each row.
9. Money: on every finished booking, show "You will receive EUR X (price EUR Y minus commission EUR Z)" and "Payment due: date", and the commission rate on the service/profile page before a provider accepts a job.
10. Receipt: add the provider's tax number, VAT or small-business wording, and the platform fee line.

Extra buttons:
- "Respond" on a dispute (a reply that is linked to the report), and "Add evidence" (photo of the box).
- "Ask for an extra quote" from the booking page (not only from a chat message).
- "Give a reason" when declining, and "Suggest another time" as a choice.

## 5. How can communication be improved?

- Put every message inside the job it belongs to. The customer's dispute text should be visible in the chat thread of that booking, with the dispute status at the top.
- One thread per job, with quote versions, additional tasks and the dispute in the same timeline. Today the original quote, the additional task and the chat are in one thread (good), but the dispute, the receipt and the review live elsewhere.
- Reply to a report from the report itself, not only from the chat.
- Use the same words everywhere: a request is a request, a quote is a quote, a job is a job (or booking), and do not mix Buchung/Booking/Auftrag on one screen.
- Use one form of address (du or Sie) throughout German.
- Read receipts or "new" marks inside a thread, so I know what I have not read.

## 6. How should communication (messages, quotes, invoices) be stored so it is easy to refer back to and find specific communication, quotes or invoices?

Proposal:
- A "case" per booking (one id, shown everywhere, e.g. B-2026-0003). Everything for that job hangs off it: request, chat, quote versions (v1, v2 ...), additional tasks (each with its own quote number), status changes, finish, dispute, review, receipt, commission invoice.
- Each quote has its own number (the app already has TEST-Q-...), its scope, price, validity and the state at each point in time. Accepted quotes are locked and linked to the receipt.
- Receipts and invoices are listed by booking and by month, searchable by number, customer name, provider name, date and amount, and downloadable as PDF and CSV (the CSV export exists for the year, but only as an invoice list).
- Search across chat text inside a booking ("find the message about the van arriving late").
- Each message and quote shows the booking id and the job title when it is viewed outside the thread (e.g. in the notifications list or search results).

## 7. Any additional feedback

- Trust and safety: the review rule and the 7-day release rule are written on the screens, which helps. Staff decisions on a dispute are shown as text; it would help to say who decided, and to show the decision in one language.
- Layout at 390 px: no horizontal scroll on the screens I checked (search, a booking, the dispute booking). I did not check text contrast or screen-reader use.
- Waiting states: the app shows a progress bar and sometimes empty tab bars for several seconds after login and after switching language. A short "Loading" line would be clearer than a blank bar.
- Empty states are friendly and short ("Nothing here yet.", "You have no invoices or receipts yet. They appear here once a booking is settled."). Good, but say when they will appear.
- Test data: the public profile and search show my typed service titles but my own screens show category names. Pick one.
- Visual design: clean, calm, and the trust badges ("Verified", "Checked documents: Photo ID") help a customer decide.
- Wording that worked well: "Your payouts are set up.", "Your profile is live. Tell people about it.", "Your review is final.".
- Wording that did not work: "Fill in the fields marked * below to go live." (no field was marked), "Entschieden: der Anbieter bekommt 35,00 €" followed by an English explanation (half German, half English).

## Customer view when All declined my request (J4)

- On the request page (Anfragen, status "Abgelehnt"): the request text, "Gewünscht: 10.11.2026, 10:00 (120 Min.)", "Vor Ort: Rosenthaler Strasse 40, 10119 Berlin", the status "Abgelehnt", "Angebote: Noch kein Angebot.". No decline reason or message shown on the page.
- In the chat with All T. (thread 981f0b7e-042e-4c5d-b0b9-4eb59aaa7310), the message from All: "Hello, thank you for asking. I have to decline this one: I am fully booked on Tuesday 10 November. I am sorry, and I hope you find someone soon." That is the only reason.
- No alternatives suggested by the app (no "other providers in your area" or "try another date"). The Search screen is the only way to find someone else, and the earlier request is not linked to it.
- The request list on Correspondence showed the request with "Abgelehnt" under the title (good: the outcome is visible at a glance).

## Summary for the coordinator

- Overall: the job cycle works and the wording is mostly clear. The biggest gaps for a real provider are money visibility (no net, no commission, no payout amount), notifications that do not say which job, a hidden "Live" requirement, and a split dispute experience (chat is not linked to the report).
- Current states of my test records: J6 c8747afb Completed (review both ways, receipt TEST-3A792693-2026-0001 EUR 20). J2 33b3bd4f finished (EUR 120, release pending). J2 additional 3a01258d finished (EUR 45, EUR 8 material cost entered). J3 cf70bef7 decided by the team: provider gets EUR 35.00, the rest goes back to the customer (shown in German with an English explanation). J4 a66d312c declined by All (customer view "Abgelehnt").
