# Phone test script: Flow 1 (MVP plan steps 1.7 and 1.10)

Written 4 November 2026. For the owner on an Android phone with the newest preview build. Use the test accounts from the README (never real people); one customer account and one provider account, ideally on two devices or by signing out between parts. Production test accounts are deleted before launch.

How to use: do the parts in order, tick each line, write what you saw next to anything that fails (screenshot if you can) and send the list back. Claude fixes what it finds and you retest those lines.

**Tap counts.** Count every tap from the Home tab to the end of each task and write the number in the "Taps" line. A tap on the keyboard does not count; typing a field counts as 1. There is no measured "before" number: the old direct booking path was removed (migration 0028) before anyone timed it, and no target was agreed, so these counts are the first measurement. Keep them for the presentation ("fewer clicks") and compare them after later changes.

## Part 0: before you start

Note (5 November 2026): all earlier test users were deleted from production (only the admin remains), so sign up a new customer and a new provider account first.

- [ ] Installed the newest build (preview, Android). The version code is on the EAS page.
- [ ] Sign-up shows an unticked checkbox with links to the terms and the privacy policy. Without the tick, sign-up refuses with a clear text (German and English). The links open the pages (they show "not found" until the pages are published: note it).
- [ ] German is the default language; switching to English changes every screen you visit.

## Part 1: customer sends a request

1. Search for a category and open a provider.
2. Send a request: what, where (use the saved address if offered), date and time with the native pickers, description.
3. The request appears under "My requests" as Pending.

- [ ] The date and time pickers are the phone's own pickers, not typed text.
- [ ] The street is not shown to the provider before the customer has accepted the quote.
- [ ] Sending a sixth open request to the same provider is refused with a sentence that names the problem and what to do.

Taps: ____

## Part 2: provider answers with a quote

1. The provider gets a notice (push or in-app) and opens it.
2. The request fields are prefilled. Send a quote with an amount, or propose a different time, or reject.
3. A numbered quote PDF exists.

- [ ] The notice text is correct German (and English after switching).
- [ ] "Quotes sent" on the Account tab lists the quote and the PDF opens.

Taps: ____

## Part 3: several quotes side by side (customer)

1. Ask two different providers for a quote, or send one request to two providers.
2. Both quotes stay valid; each has its own Accept button; the table of accepted quotes shows the one you accept.

- [ ] Accepting one quote does not cancel the other quote's chat.
- [ ] "My received quotes" lists both and each PDF opens.

## Part 4: confirm and pay

Stripe is in TEST mode. Use these cards only.

| Case | Card | Expected |
|---|---|---|
| Paid | 4242 4242 4242 4242 | Booking appears as booked; provider gets a notice. The invoice or receipt appears after the job is completed and settled |
| Declined | 4000 0000 0000 0002 | A clear text; no charge is made; the booking stays "waiting for payment" and you can pay again |
| 3-D Secure | 4000 0027 6000 3184 | The extra step opens and completes |

- [ ] Decline on a quote first offers "Open chat"; "Decline anyway" ends it and tells the provider.
- [ ] Two customers confirming the same time: only one wins; the other gets a plain sentence.
- [ ] A quote that was not paid in time shows the lapse banner with "I don't need this anymore".

Taps (quote to paid): ____

## Part 5: chat, uploads, account

- [ ] Chat message and chat photo are sent and arrive within about 4 seconds on the other phone.
- [ ] Portfolio photo, a document as PDF and as photo upload. If an upload fails with 411, tell Claude (README step 1.10 has the one-line fix).
- [ ] Airplane mode: the screens show an error with a Retry button; Retry works after switching the network on.
- [ ] "Offer services" switch works; the earlier error is gone.
- [ ] The Open buttons on notices open the right screen; a job does not disappear after its notice is closed (findings 4 and 6).
- [ ] "Your data" in the Account tab exports as JSON and CSV and mentions the terms acceptance time.
- [ ] Delete account: a wrong password is refused with a clear text, the right password deletes. Do this last, with a throw-away account.

## Part 6: AI document check (provider, a made-up document only)

- [ ] Upload a made-up ID or trade document (never a real one).
- [ ] The person sees nothing extra on screen (owner decision of 3 November).
- [ ] Staff see the suggestion panel in the back office and decide as before.
- [ ] A document of an account that has not accepted the terms goes to staff with the reason "terms not accepted".

Documents screen (added 5 November 2026, PR #90; provider account, My profile, documents):

- [ ] The screen has two collapsible groups: Required documents and Optional documents.
- [ ] Required is red while any required document is missing or rejected, and it starts open.
- [ ] Required turns green only when every required document is approved; while documents are in review it is neutral.
- [ ] Optional is indigo while none is uploaded, and it starts closed.
- [ ] A rejected optional document turns that group red and opens it, with the rejection note visible.
- [ ] The counter next to each heading counts approved documents only, for example 1/2.
- [ ] The arrow toggles the group, and the rows keep their add and edit buttons.

## Part 7: scan your ID card (optional feature; a made-up or your own test card, never someone else's)

- [ ] Account screen: the note above the button says what happens to the photo; "Scan your ID card to fill in your details" opens Camera / Photo library / Cancel.
- [ ] Camera and library work on Android and on iPhone; refusing the permission shows the "open settings" notice.
- [ ] A readable card fills first name, last name, date of birth, street, postcode and city; nothing is saved until you tap Save; after Save the values are there again after leaving the screen.
- [ ] A photo that is not an ID card (a cat, a blurry card) shows "No ID card could be read..." and changes nothing.
- [ ] The date of birth field opens the phone's own date picker and keeps the day you chose (check a day near midnight).
- [ ] An account without accepted terms gets the clear message; the 11th scan in an hour gets the "too many times" message.
- [ ] Typing everything in by hand still works and saves.

## Result

Date: ______ Phone: ______ Build: ______ Tester: ______
Failed lines (number and what you saw): ______
