# Diary: All (provider and customer)

### Step 1: Open app and start sign-up
- Opened http://localhost:8082 at 390x844. Cleared old session. Welcome screen shows "I need help" and "I offer my skills" buttons plus "Log in/Register" link at top.

### Step 2: Fill sign-up form (name All Tester, email liezljvv74+all@gmail.com, postcode 10117, password, "I offer a service", terms)
- Path: Welcome > "Log in/Register" > Login > "No account yet? Sign up" > sign-up form.
- Text fields filled with fill form (1 call). "I offer a service" checked on first tap (shows check mark and dark-blue tile).
- Terms checkbox: the first 3 taps did not visibly toggle it; a 4th tap did (checked square). Friction: a tap on the text "I am at least 18 years old..." opened the Terms page in a NEW TAB instead of ticking the box.
- Profile picture: tapping "Profile picture" button (3 tries, Playwright click and JS click) showed nothing: no picker, no file input in the page. browser_file_upload refused ("related modal state"). Not a placeholder upload: PLACEHOLDER NOT USED, profile photo still missing. Tap count so far high for this step (about 10).
- Text on screen: "Providers see who they are working for. A picture keeps both sides safer."
- Clicked "Create account" without a profile picture: the app accepted it and moved to /verify-email?email=liezljvv74%2Ball%40gmail.com. Sign-up step done for now.
- Waiting for the 6-digit email code. Turn 1 stopped here on purpose.

### Step 2 status
FLOW RATING sign-up (part 1): pending until the code is entered.
- Friction: profile picture button gave no feedback (no picker), terms tick needed several taps and the Terms text opened a new tab.

### Step 3: Enter the email code (coordinator gave 893687)
- Verify-email screen: "Check your email" / "Enter code" / "Confirm email". Typed the code in one fill, one tap on "Confirm email".
- Result: straight to /my-profile?welcome=1 (no separate login). 2 taps total for the code. Good.
- Friction: My profile opens with a banner "Add your picture so providers can recognise you. It keeps both sides safer." plus "Add picture" and an x. Also "I need help" and "I offer my skills" cards and a progress bar "Let's set up your service profile".
- PHOTO: "Add picture" button is covered by a "Services" element (tap timed out), a 4th photo attempt did no file chooser. Total photo attempts: 4 (over the 2 allowed). PLACEHOLDER NOT USED for the photo. Photo skipped for now, to add later from the profile screen.

### Step 4: Profile set-up, About you
- Path: My business > "Let's set up your service profile" (progress card: Live switch disabled, "Fill in the fields marked * below to go live."), then Edit "About you".
- Entered: Provider type (default "Private person or business"), Strengths "Reliable and punctual", "Friendly"; Skills "Garden care", "Hedge trimming"; Experience text; Postcode 10117 and radius 25 km were already pre-filled from sign-up.
- Chips: typing + Enter adds a chip. The chip "Add strength"/"Add skill" button stays disabled until typed, which I did not expect (I expected to tap the button). Typing with a plain fill also added the first chip without Enter.
- No visible "Save" button on the About page in the snapshot. Checking whether Back keeps the changes.
- Taps when the tab bar overlaps: the bottom tab bar blocks taps on the lower page (earlier "Add picture" and "I offer my skills" card timed out). Friction.

### Step 5: Add services (3 services: Gardening, Cleaning, Assembly)
- Path: My business > "Add service" (+) > New service > Category (radio list in a sheet: Photography, DJ, Catering, ..., Cleaning, Moving, Assembly, Gardening, Small repairs, Other) > Description > Price type (Fixed price / Per hour / From price / Price on request) > Price EUR > Back.
- Gardening: Per hour, EUR 28. Saved as "€28.00/hr". Cleaning: Fixed price, EUR 85 ("€85.00"). Assembly: Fixed price, EUR 45.
- Each service auto-shows "Document needed: Photo ID (ID card or passport)". Good to see the document needed in the card.
- Friction: Back link saves immediately, but there is no visible save. Taps on the lower page on this screen get blocked by the bottom tab bar.
- Title field: placeholder shows the category name (Gardening), left empty.
- Tap count per service: about 9 (Add service, Category, radio, Description, Price type, radio, price, Back, plus a snapshot each time).

### Step 6: Required document (Photo ID, placeholder)
- Path: My business > "Verification documents" > "Required documents (0/1)" > "Photo ID (ID card or passport)" > "Not uploaded yet" > Add.
- Tapped "Add: Photo ID" on the list, then "Add" on the document page (2 taps). Each tap went to /my-profile/document/id-document with the text "Not uploaded yet" and "Add".
- browser_file_upload failed each time ("related modal state present"). No file input is in the page at all.
- BLOCKED: photo ID document not uploaded. PLACEHOLDER NOT USED (no picker opened). Coordinator decides.
- Friction: the list says "Consider submitting additional documents, as proposed below ... Your documents will be vetted for authenticity, but will never be shown to anyone." Clear enough. The document is required for every service, so the 3 services stay blocked until it is uploaded.

### Step 7: Personal data (Account > My data)
- Path: Account tab > "My data" (name prefilled from sign-up). Filled Date of birth, Street "Kastanienallee 12", City "Berlin". Tapped Save; "Saved" text appeared.
- Friction: the date field is a native date box and rejected "14.03.1988" (stayed empty, no error text). The ISO format 1988-03-14 worked. An ordinary German user would type 14.03.1988, so the field should accept that or show the format.
- The AI card "Scan your ID card to fill in your details" appeared here; the text says the photo is not saved and the user checks each field. Not used (needs a file upload that does not work here).
- Notifications: "Chat messages" and "Reminders" are on by default. Also a "Delete my account" button and an "Admin panel (test version only)" link appear on Account.

### Step 8: Look for availability, service area and payout (Stripe)
- Service area: already on About you (Postcode 10117, Service radius 25 km, "Also work remotely" switch). Nothing else found for area.
- Availability: NOT FOUND. No availability screen on My business, on About you or on the service edit page (the service edit page has Category, Title, Description, Price type, Price, Remove). Could not set opening times.
- Payout / Stripe onboarding: NOT FOUND on My business or Account. No payout card or bank/IBAN field appears. Possibly it only shows once the profile can go Live (which needs the Photo ID document). Did not reach it.
- Live switch: still disabled, text "Fill in the fields marked * below to go live." The profile shows "Draft: not visible to customers". No text explains which field is still missing (the document is in a list further down, and it is not named by the switch).
- Good: the page "Documents" block says "Your documents will be vetted for authenticity, but will never be shown to anyone. Potential customers will see a list of the documents you submitted."

### Status at end of this turn (not logged out, set-up unfinished)
- Done: sign-up with code, About you (2 strengths, 2 skills, experience, radius 25 km), 3 services (Gardening EUR 28/hr, Cleaning EUR 85 fixed, Assembly EUR 45 fixed), personal data (DOB, street, city).
- Blocked: Photo ID document (file chooser does not open in this browser), profile photo (3 tries), availability (no screen found), payout/Stripe (not reached, likely gated).

FLOW RATING sign-up and verification (part): 3/5 - code step is quick (2 taps), but the photo button gives no feedback and the terms tick needed several taps.
FLOW RATING profile set-up: 3/5 - About and My data are clear and save; the bottom tab bar blocks taps on lower buttons, and there is no visible save on About.
FLOW RATING provider set-up (services): 4/5 - Add service, category, price type and price are clear; each service shows its required document.
FLOW RATING provider set-up (documents and payout): 1/5 - photo upload does not open; availability and payout not found from the screens.

### Step 9 (second round, browser had reloaded, still signed in as All)
- Profile photo: "Change profile photo" opens a sheet "Profile picture" with "Camera", "Choose photo", "Remove picture". Sheet makes sense; the choice is clear.
- Chose "Choose photo". PLACEHOLDER USED (red toast "TEST HARNESS: placeholder file used"). Then the photo area showed a spinner and then the error text: "Something went wrong on our side or on the way, and nothing was lost. Please try again; write to info@skillweb.space if it keeps happening." The avatar stayed "AT"/initial-style. Photo NOT saved on this try.
- Friction: the message blames "our side or the way" with no hint what to do (retry? smaller file?). Also the message gives an email address to write to.
- Retry (2nd "Choose photo"): PLACEHOLDER USED again, same error "Something went wrong on our side or on the way, and nothing was lost..." Photo not saved. BLOCKED (2 tries). Note: the avatar image is still the old one from before (an image URL from storage is present), so unclear what the app shows. Coordinator decides.

### Step 10 (second round): Photo ID document
- Path: My business > "Verification documents" > "Required documents (0/1)" > "Add: Photo ID" > document page "Add".
- First try: Add opened the document page; Add then showed "Something went wrong on our side or on the way, and nothing was lost. Please try again; write to info@skillweb.space if it keeps happening." with "Try again". Try again repeated the same error.
- Later tries: the document page showed the same error straight away on open, before any tap on Add. So the file step never ran with a placeholder.
- PLACEHOLDER NOT USED for the document (the document Add never reached the sheet). BLOCKED.
- Coordinator should check the API path for this upload (the same error appeared on the profile photo).

### Step 11: Availability, payout (Stripe) and Live switch
- Availability: still not found anywhere (My business, About you, service edit page, Account).
- Payout / Stripe onboarding: still not found. No bank, IBAN, payout or Stripe entry is shown on My business or Account. A real provider would expect it on My business, or in the Live checklist. Not reachable.
- Live switch: disabled. Text: "Fill in the fields marked * below to go live." Tapping it does nothing. Every field marked * on About you is filled (provider type, strengths, skills, postcode, radius). The only missing item I can see is the required Photo ID document, and the app never says that near the switch. That is the gap.

FLOW RATING profile photo: 1/5 - sheet is clear (Camera / Choose photo / Remove picture), but both uploads ended with the generic error.
FLOW RATING documents and payout: 1/5 - the document page errors out, availability and payout are not found, and the Live switch gives no reason.
FLOW RATING provider set-up overall: 2/5 - services and personal data are easy; the blocked items leave the profile as "Draft".

### End of turn
- Logged out (localStorage cleared) at the end of this turn.
- Not done (blocked before approval): profile photo, Photo ID document (3 services need it), availability, payout / Stripe onboarding, Live.

### Step 12 (third round, signed in again with email + password)
- Log in: Log in > email, password > Log in. Went to Home, then My business (took about 8 seconds: a spinner "progressbar" first, then content). Friction: the first screen after login is empty for several seconds.
- Photo ID: "Required documents (1/1)" > "Photo ID (ID card or passport)" > status "Approved". The service cards no longer say "Document needed: Photo ID". The app did NOT show any in-app notice, toast or message about the approval in what I saw (My business, Correspondence). Could not check e-mail (not to be read by me). Push not available. So the approval is visible only as the status word on the list.
- Live switch: still disabled, text "Fill in the fields marked * below to go live." It does not say what is missing. All About you fields are filled, the document is approved. Still "Draft: not visible to customers". Not live yet.
- Correspondence tab: "My requests and bookings", "Quotes", "Messages", "Invoices and receipts" (4 rows, each with an arrow). Nothing to show yet.
- Account tab: "My data" (name, DOB, street, postcode, city), "I want to provide a service" (on), Notifications (Chat messages on, Reminders on), "Delete my account", "Admin panel (test version only)". No payout / bank / Stripe entry visible.
- Payout / bank account: NOT found on My business, Account, Correspondence top-level. Checking Invoices next.
- Account avatar: now shows "All Tester" initials image on Account (the photo upload may have stuck or is the initial). Not clear whether a photo is saved.

### Step 13: Payout (Stripe) and Live
- Invoices and receipts (Correspondence > Invoices and receipts): empty state "You have no invoices or receipts yet. They appear here once a booking is settled."
- Payout: the only sign was a heading "Set up payouts" with a spinner on My business, shown for a few seconds right after I tapped "I offer my skills" on Home (it opened /my-profile). Then it vanished, and it did not come back on later visits (My business tab, reload). I could not reach a bank or IBAN form, so I did not enter the test IBAN. Friction: the payout step is not in the provider set-up list I can see; I could not tell where it belongs, and it disappears without a message.
- Reloading /my-profile by URL redirects to Home and shows a spinner first (about 10 seconds to load). Use the tab bar.
- Live: still disabled ("Fill in the fields marked * below to go live."). Not live.
- Availability / calendar: still not found.

### Step 14: Provider inbox (none yet) and customer-side search
- Correspondence > "My requests and bookings": tabs "As customer" and "As provider", sub-tabs "Bookings" and "Requests", text "Nothing here yet." The provider's requests sit under "As provider"; I did not know that at first (it is inside the request screen, not on the main list).
- Correspondence > "Quotes": "You have no quotes yet. They appear here once a quote was sent or received."
- Correspondence > "Messages": "No conversations yet."
- Correspondence > "Invoices and receipts": empty (see step 13).
- Friction: the four Correspondence rows are all empty. Nothing says where a provider gets new requests (no hint on the empty screens: "Requests will appear here when customers ask for your services" would help). Not a real provider's view yet, because the profile is not live.
- Search (customer side, tab "Search"): "Find providers" with Category (All categories), Postcode, Search term (optional), Find. Results list other providers with "New" tag, category, price ("from €28.00"). Whether my own draft profile ("All T.") appears in the results could not be confirmed: the page keeps old screens in the page text, so the check is not reliable.
- Live: not done (still disabled). Availability: not found. Payout: not reached (see step 13).

### Step 15 (fourth round, servers restarted, payments on)
- Login: email + password, Log in, then about 10 seconds before the app showed Home. Friction: slow first load.
- Looked for "Set up payouts" on My business (tab, after 8 seconds): not there. Tapped Home > "I offer my skills" (3 times, incl. a immediate check): My business opened, no "Set up payouts". Only the heading I saw once in round 3 appeared then, and not now.
- Account tab: no payout, IBAN, bank or Stripe entry. Only the notification line "You always get a notification about your bookings and payments."
- So no Stripe onboarding page was reached: no new browser tab, no test IBAN entered, no invoicing tax number, no invoice consent (the app did not show these either).
- Live switch: still disabled, same text "Fill in the fields marked * below to go live." Not live.
- Availability: still not found.
- BLOCKED: payout (Stripe onboarding) and Live. The app gives no route to set up payouts that I can find, and it does not say what is missing.
- Logged out at the end of this turn (localStorage cleared).

### Step 16 (fifth round, payments on): payout via Stripe, tax number, consent, Live
- Login: slow first load, about 10 seconds after Log in before Home.
- Set up payouts: found on My business (after about 10 seconds). Section "Set up payouts" > "Not finished yet" > button "Set up payouts". Tap 1: opened a NEW TAB (Stripe, test account "EfficientLife sandbox"). Tab switching: 1 switch to the Stripe tab; after finishing I closed it and switched back.
- Stripe onboarding taps and screens (about 40 taps in total):
  1. "Use test phone number" (phone +49 filled with test data), 2. Submit, 3. "Use test code" (SMS code 000000 filled), 4. business type already set to Privatperson (Einzelunternehmen), Continue, 5. personal details: name All Tester, DOB 14/03/1988 typed in three boxes, address Kastanienallee 12, 10117 Berlin, Continue, 6. website: https://example.com and https://www.example.com both rejected ("Not a valid URL"); used "Add product description instead" and typed a product description, Continue, 7. payout: country Germany, IBAN DE89370400440532013000 typed twice, Continue, 8. review: "Personal details: Incomplete" blocked "Agree and submit"; Edit showed "ID verification ... You can use test data on the next screen", Start verification, 9. Stripe identity dialog: "Simulate" > "Successful verification" > "Submit result" (needed a second click), 10. back on review: "Agree and submit", 11. Stripe "Almost done" page on the Stripe domain with "If you finished the payout set-up, the app shows it in a moment ... tap 'Set up payouts' again."
- The app did not update after the first pass. The status stayed "Waiting for Stripe. Finish the set-up there, then come back." and "Not finished yet". Tapping "Continue payout set-up" opened Stripe again, showed "Review and confirm" with one button "Confirm"; I pressed Confirm, went to the "Almost done" page again. Then the app showed "Your payouts are set up."
- Friction: no clear "done" in the Stripe flow; the app needed a second Stripe visit to update; the "Back to the app" link points to skilled://my-profile (a custom link that does not open from a browser).
- Tax number: field "Tax number" with help text "Needed if you are a small business (Kleinunternehmer) or a business without a VAT ID: it is printed on your invoices." Typed DE123456789.
- Invoice consent: switch "The platform issues invoices and receipts for my jobs in my name." turned on (1 tap). Text "Before you can send quotes and accept bookings, agree that invoices are issued in your name." disappeared.
- Live switch: still disabled, text "Fill in the fields marked * below to go live." All About and services fields are filled; photo missing; availability not found anywhere. The only item I cannot see is which one is missing. Not live.
- Availability / calendar: not found anywhere in the provider set-up (My business, About you, service edit, Account).
- Payout status is now "Your payouts are set up."

### Step 17 (sixth round): Provider type, Live
- KEY FINDING: About you shows "Provider type *: Private person or business" already selected, with no tick and no error. It was NOT saved on the server (the Live switch stayed disabled, "Fill in the fields marked * below to go live."). The screen should have told me the field was empty (a clear "Choose your provider type" with no default), or saved the default when shown.
- Choosing it properly: tap the dropdown (1 tap, opens sheet "Provider type *" with options "Private" and "Business"), tap "Business" (2 taps), this showed NEW required fields "Business name *" and "Legal notice *" (not mentioned before), tap dropdown again (1), tap "Private" (1). Total 5 taps to set Private. Re-entry: Back, then Edit About you: "Private" stays. The About you summary line on My business shows "Private".
- After choosing, the Live switch became ENABLED (no longer disabled), and the line "Fill in the fields marked * below to go live." disappeared.
- Live: tapped the switch (1 tap). The app shows the line "Your profile is live. Tell people about it." with a "Share" button, and the status changes from "Draft: not visible to customers" to "Published: visible to customers". No pop-up; the confirmation is inline on My business.
- Home: after payouts the Home screen showed a notice bar "Your payouts are set up. Agree to invoicing on the payout card before you send quotes and accept bookings." with an x (this IS an in-app notice, the only one I have seen). It stays on My business too.
- Friction: The Live state had no explanation for 3 rounds; the default provider type looked filled.
- FLOW RATING Live (with provider type fix): 2/5 (it works once the field is chosen, but the default looked like a value).
- FLOW RATING About you (provider type): 2/5.
- Share button ("Your profile is live. Tell people about it." > Share): tapped once; nothing visible happened in this browser (no sheet, no link copied on screen). Unclear whether it would open the native share sheet on a phone.
- Customer search (Search tab, after going live): my profile is listed first: "All T. New Cleaning · Assembly · Gardening from €28.00". It shows the photo area with initials only (no photo, because the photo upload failed).
- Public profile (tap the card, opens /provider/all-t): shows "All T.", "New", "Verified", "Berlin", "Gardening · Cleaning · Assembly", "Checked documents: Photo ID", a "Translate" button, Strengths (Reliable and punctual, Friendly), Skills (Garden care, Hedge trimming), Experience text, and the three services with descriptions and prices (€28.00/hr, €85.00, €45.00). This is a good preview; "Verified" appeared on the public profile, which the app did not announce on My business.
- Logging out at the end of this turn.

### Step 18 (seventh round, provider inbox and two jobs)
- Login: Log in > email, password > Log in, about 12 seconds before the Home screen (spinner first).
- How I learn of new requests (as a real provider): on Home, as banners at the top: "You have a new request with a date, time and place. Send a quote or decline within 3 days." (x2), "You have a new message.", and "+1 more messages". Each banner has "Open" and "×". The Correspondence tab shows a red badge with "3". No push here; the banners are the in-app notice. Good: request banners say the deadline (3 days).
- Friction: the banners come with a count of "+1 more messages" but no names or dates, so you need to open each one.

### Step 19: J1 request from Customer Tester (hedge trimming), as provider
- Path: Correspondence (badge 3) > "My requests and bookings" (row says 2) > "As provider" (tab; the view opens on "As customer" first, which shows "Nothing here yet.") > request card "Our garden hedge..." > request page.
- Taps to reach the request from Home: about 5 (Correspondence, My requests, As provider, card). Friction: the default tab "As customer" is shown first, so a provider lands on an empty page and has to find "As provider".
- Request page: requested Nov 11, 2026 10:00 AM (180 min), on site 10115 Berlin (only postcode), customer note in German/English mix, "Answer by Nov 9, 2026, 1:22 PM" (3 days). Actions: "Open chat", "Decline request", and the quote form.
- Chat: customer asked if 10:00 on Wed 11 Nov works for ~3 hours and if the price is EUR 28/h (about EUR 84). Replied in chat (1 type, 1 Send, Send button stayed disabled until typed). Chat header shows "Customer T." with "Block", messages show time stamps "Nov 6, 2026, 1:23 PM".
- Quote form (on the request page, below the request): "Amount in euro" (textbox), "Scope of the work" (textbox), switch "Date and time confirmed" (on by default), "Date" (2026-11-11 prefilled), "Time of day" (10:00 prefilled), "Duration in minutes" (180 prefilled), button "Send a quote". Filled amount 84 and scope text, then Send a quote: 1 tap.
- Result: "Quote sent", Quotes €84.00 with the scope text. Taps for the quote: 4 (fill x2, send, check).
- Friction: the quote form is at the bottom of the request page; no hint of what the amount means (hourly vs total). The form does not say whether the customer sees the quote at once.

### Step 20: J5 request from Customer (move-out clean), as provider
- Path: My requests and bookings > As provider > card "Move-out clean of a 2-room flat..." (2 taps from there; card shows the request text, "Open").
- Request page: requested Nov 17, 2026, 9:00 AM (240 min), on site 10115 Berlin, customer note "The fixed price of EUR 85 is fine ... Please confirm in chat if the 4 hours is realistic." Amount field already filled with 85 (prefilled from the customer's price).
- Chat: "No messages yet. Write the first one." I wrote a reply (type, Send): confirmed Nov 17 09:00 and 4 h realistic, EUR 85 fine. MISTAKE: I wrote "Friday 17 November". 17 Nov 2026 is a Tuesday. Sent a correction message right after ("Correction: 17 November 2026 is a Tuesday..."). Lesson for the app: the request shows only the date, not the weekday; a weekday label next to the date would prevent this.
- Quote: amount 85 (prefilled), scope text typed, "Send a quote". Result: Quotes €85.00, "Suggested time: Nov 17, 2026, 9:00 AM", "Open · Valid until Nov 13, 2026, 1:31 PM" (the validity is about 7 days, which is not explained). 4 taps for the quote incl. Send.
- Friction: the quote form and the request share one page; the quote is final once sent (no edit seen). Not clear whether the customer is notified (no notice here; customer side to check).
- FLOW RATING provider request and quote (both jobs): 3/5 (clear once found; "As provider" hidden behind the default "As customer" tab; the weekday mistake shows the date field needs a weekday).

### Step 21: J3 as CUSTOMER (All -> AllMore T.)
- Switching hat: no switch control. Home has the cards "I need help" (customer) and "I offer my skills" (provider). The customer side is reached by "I need help" or Search; the provider side by "My business" and Correspondence > "As provider". Nothing on Home, Search or the top of a screen says which hat I am wearing.
- Found All_More in Search: "AllMore T. New Photography · Dog walking · Moving & house clearance from €20.00" (profile /provider/allmore-t). Profile: "Verified", "Checked documents: Photo ID, Permit", services "Van help for moves" EUR 35.00/hr with "Request a quote" and "Portrait and event photos" EUR 120.00 with "Book". Note: a service with "Book" and one with "Request a quote" look alike; the difference (fixed/hourly vs quote) is only the button text.
- Request form (/bookings/new-request): "What needs to be done?", "Date", "Time of day", "Duration in minutes" (60 prefilled), "Street and number (optional)" and "Postcode" and "City (optional)" (prefilled from my profile), "Note (optional)", "Photos for the provider (optional)", "Send request". The form says "A quote is valid for 7 days" and "The provider answers with a quote". No price estimate is shown on the form for EUR 35/h.
- Filled: task text, date 2026-11-13 (Friday in a few days), time 10:00, duration 120, note. "Send request": 1 tap. Result: request page with "Requested: Nov 13, 2026, 10:00 AM (120 min)", "On site: Kastanienallee 12, 10117 Berlin", "Open", "Answer by Nov 9, 2026, 1:33 PM", "Open chat", "Withdraw request".
- Question in chat with AllMore T. (do they bring a van; EUR 35 per hour for one or two helpers): sent, 1 tap Send after typing.
- Friction: the 2-hour job at EUR 35/h has no total shown before sending; the request page does not show the price.
- FLOW RATING send request (customer): 4/5 (clear form, prefilled address).
- FLOW RATING switching roles: 2/5 (no hat indicator; provider banners appear on the customer request list).

### Step 22 (eighth round): provider payment/cancellation, decline, customer quote acceptance/payment, job completion
- Login: about 12 seconds again before Home.
- Home banners now (provider): "A booking was cancelled." (x), "A booking was paid. The appointment is confirmed." (x), "The customer accepted your quote. If no date and time was set yet, please agree it in the chat." (x), "+10 more messages". Correspondence badge: 10. The payment and cancellation messages are short; "A booking was cancelled." does not say which job or who cancelled, or whether money is refunded (you need to open it).
- Provider bookings list (My requests and bookings > As provider): section "Bookings": "Nov 17, 2026, 9:00 AM - The customer cancelled in time." and "Nov 11, 2026, 10:00 AM - Paid and confirmed". Section "Requests": Assembly wardrobe (Open), Move-out clean (Booked), hedge (Booked).
- Cancelled booking 527499cb-3eff-49cf-9a13-53da2cafd2cb (the move-out clean): page shows "Quote TEST-Q-0988F5C3-2026-0002", "The customer cancelled in time.", "Time: Nov 17, 2026, 9:00 AM (240 min)", "Amount: €85.00", "Place: On site: Torstrasse 100, 10115 Berlin" (full street now visible after booking), and "Open chat". NO refund wording on the provider page: nothing says the customer was refunded or that I get nothing. Friction: the provider needs to infer the money side; the Home banner was just "A booking was cancelled." with no amount.
- Paid booking ff0239dc-71d7-4143-9221-da5b3b57a2de (J1): heading "Paid and confirmed", "Time: Nov 11, 2026, 10:00 AM (180 min)", "Amount: €84.00", quote TEST-Q-0988F5C3-2026-0001. Buttons: "Open chat", "Scope/quote review", "Cancel the booking". NO "mark as done" / complete button anywhere on the page (searched the text for done/complete/finish/mark: none). "Scope/quote review" opens a sheet about the ADDITIONAL task only: "Work on the additional task starts only once it is accepted and paid. Until then, only the original job is owed." with "Start the additional task" (not used). The payment itself is shown only as the banner "A booking was paid. The appointment is confirmed." The page gives no date-based rule for completion.
- DECLINE (J4 from All_More, Assembly wardrobe, a66d312c-46a7-4dc2-b225-91d88f5ac531): request "Assemble one flat-pack wardrobe ...", requested Nov 10, 2026 10:00 (120 min), on site 10119 Berlin, answer by Nov 9. Decline flow: "Decline request" button under the request > alert "Decline this request? The customer is told." with "Cancel" and "Decline request". NO reason options and NO reason field in the decline dialog. I gave the reason in chat first (All_More had asked about tools and the EUR 45 price): "I have to decline this one: I am fully booked on Tuesday 10 November." Then declined: 2 taps + 1 chat type + 1 send. Status after: "Declined". The customer sees "The customer is told" (the wording on the dialog); the exact text the customer sees was not verifiable from my side.
- Friction: the decline dialog promises the customer is told, but there is no reason choice; a reason has to be typed in chat separately.
- Quote for J3 (customer side, from AllMore T.): found on the request page (/bookings/request/3381f8dd-...): status "Quote sent" in the request header, and the Quotes block shows "€70.00 - Van with one helper, 2 hours (EUR 35 per hour x 2) for a sofa and boxes. Loading and unloading included. Suggested time: Nov 13, 2026, 10:00 AM. Open · Valid until Nov 13, 2026, 10:00 AM" with "Confirm quote". No banner I noticed on the request page; the quote appeared on the request list card as "Quote sent" (how I learnt of it: I opened the request). Friction: no push, and I did not see a Home notice for it in this session.
- Confirm quote: 1 tap > new booking page cf70bef7-1468-4646-94f0-2839afa3834e, "Quote TEST-Q-3A792693-2026-0001", heading "Waiting for your payment, pay by Nov 8, 2026, 1:52 PM", "Amount: €70.00", buttons "Pay now", "Open chat", "I no longer need this".
- Pay now: 1 tap, opens Stripe Checkout in a NEW TAB ("EfficientLife sandbox", "Booking on 13/11/2026, 10:00", €70.00). Checkout first showed wallet buttons (Apple Pay, Link, Klarna, Amazon Pay) and "Payment method": Card, Klarna, Bancontact, MB WAY. The card fields were hidden behind the accordion until I tapped the "Card" row a second time (the first tap failed: the accordion covered it). Entered email, card 4242 4242 4242 4242, 12/30, CVC 123, cardholder name "All Tester". Taps: about 7 (email, card row, card number, expiry, CVC, name, Pay).
- Return: Stripe showed "Thank you. If you completed the payment, it is being confirmed now ... you will see your booking as confirmed in the app." Closed the tab, went back to the app tab, reloaded the page: booking "Paid and confirmed", "Paid" tag, "Amount: €70.00", buttons "Open chat", "Additional task", "Cancel the booking". No pop-up. The app confirmed by the status change after a reload (the first load did not show it).
- Friction: the payment page says "being confirmed now"; I had to reload the app page to see it. The return link "Back to the app" is skilled://bookings, which does not work from a browser.

PROVIDER: STATUS OF J1 AND THE CANCELLED JOB
- Home banners (provider): "A booking was cancelled.", "A booking was paid. The appointment is confirmed.", "The customer accepted your quote. If no date and time was set yet, please agree it in the chat.", "+10 more messages". All short, none names the job, the amount or the refund.
- Bookings list (As provider): "Nov 17, 2026, 9:00 AM - The customer cancelled in time." and "Nov 11, 2026, 10:00 AM - Paid and confirmed".
- Cancelled booking 527499cb-3eff-49cf-9a13-53da2cafd2cb: "The customer cancelled in time.", "Amount: €85.00", "On site: Torstrasse 100, 10115 Berlin". NO refund or payment text on the provider page.
- Paid booking ff0239dc-71d7-4143-9221-da5b3b57a2de (J1): "Paid and confirmed", "Time: Nov 11, 2026, 10:00 AM (180 min)", "Amount: €84.00". Buttons: "Open chat", "Scope/quote review", "Cancel the booking". NO completion / "mark as done" control on the page. "Scope/quote review" opens only the additional-task sheet ("Work on the additional task starts only once it is accepted and paid. Until then, only the original job is owed." / "Start the additional task"); I did not start one. The page gives no rule about when completion is possible. So I could not try to mark J1 done: there is no control.

DECLINE (J4, All_More wardrobe, a66d312c-46a7-4dc2-b225-91d88f5ac531): "Assemble one flat-pack wardrobe ...", "Requested: Nov 10, 2026, 10:00 AM (120 min)", "On site: 10119 Berlin", "Answer by Nov 9, 2026, 1:38 PM". Decline: tap "Decline request" > dialog "Decline this request? The customer is told." with "Cancel" and "Decline request". NO reason choice in the dialog. I wrote the reason in chat first (AllMore T. had asked about tools and the EUR 45 price): "I have to decline this one: I am fully booked on Tuesday 10 November." Then declined: 2 taps. Result: request header "Declined". Customer-facing wording: "The customer is told." (text on the dialog; I could not see the customer's version).
- FLOW RATING decline: 2/5 (quick, but no reason field; reason only in chat).
- FLOW RATING provider payment and cancellation info: 2/5 (short banners, no amount or refund on the provider side).
- FLOW RATING job completion (provider): 1/5 (no complete control on the paid job; no rule about when it is possible).

BOOKINGS FOR THIS ROUND
- J1 hedge (provider side): ff0239dc-71d7-4143-9221-da5b3b57a2de, status Paid and confirmed (EUR 84, Nov 11 10:00)
- J5 move-out clean (provider side): 527499cb-3eff-49cf-9a13-53da2cafd2cb, status cancelled by customer in time (EUR 85, Nov 17 09:00)
- J4 wardrobe (provider side): request a66d312c-46a7-4dc2-b225-91d88f5ac531, status Declined
- J3 van (customer side): booking cf70bef7-1468-4646-94f0-2839afa3834e, status Paid and confirmed (EUR 70, Nov 13 10:00), quote TEST-Q-3A792693-2026-0001

### Step 23 (ninth round): J1 finish, provider
- Test-setup note: J1 date moved to Nov 6 10:56 AM; the booking now offers "Job finished".
- Finish control: on the booking page (ff0239dc...), button "Job finished" (1 tap). Sheet text: "The customer then has 7 days to confirm or report a problem. Without an answer the payment is released after the 7 days." Field "Of which material costs, in euro (optional)" (left empty), button "Mark as finished" (1 tap).
- Result heading: "You marked the job finished. The payment is released on Nov 13, 2026, 2:07 PM unless the customer reports a problem." Buttons now: "Open chat", "Report a problem" (appears for the provider too), "Scope/quote review". Taps: 3 (Job finished, Mark as finished, plus a check).
- Friction: the release date (7 days) is in the sheet and the result heading, but not in the Home notice. The provider sees "Report a problem" on their own booking, which is confusing (is it for disputes about the customer?).
- FLOW RATING finish job (provider): 4/5 (clear: one sheet, explicit 7-day rule and release date).

### Step 24 (ninth round): J3 dispute, as customer
- Learned the provider finished: no push. On my Correspondence list (As customer): banner "The provider marked the job as finished. Confirm it or report a problem, otherwise the payment to the provider is made after 7 days." (Home banner list) and the booking row "The provider marked the job finished. The payment to the provider is made on Nov 13, 2026, 2:00 PM unless you report a problem." Booking heading then: "The provider marked the job finished. The payment to the provider is made on Nov 13, 2026, 2:00 PM unless you report a problem." with "7 days left to confirm or report a problem." Buttons: "Open chat", "Confirm the job was done", "Report a problem", "Additional task". I did NOT confirm.
- Report a problem (1 tap): the form shows "Describe it calmly and factually. Our team reads it and decides within 14 working days. No money moves until then." Field "What went wrong?" and button "Send the report". NO photo field on the form (PLACEHOLDER NOT USED: the form offers no photo; photos may only be possible in chat, not checked).
- Text entered: late arrival (about 45 min), one damaged box (corner crushed, contents not checked). Taps: Report a problem (1), field (1), type (1), Send (1) = 4.
- Result: heading "Being reviewed by our team". Booking shows only that heading, the amount, the time and "Open chat". No reference number, no next-step text, no deadline shown (the 14 working days text disappeared after sending).
- How the provider is told: not visible from my account (I cannot see AllMore T.'s side). Unknown.
- FLOW RATING dispute: 3/5 (the form is clear and calm; the rules 14 working days and no money moves are shown before sending, but the result page loses the deadline).

### Step 25 (final turn): dispute decision and provider state
- Customer J3 (cf70bef7-1468-4646-94f0-2839afa3834e): heading still "Being reviewed by our team" (stale). Below it: "Under review" > "The customer reported a problem with the job." + my text, then "Decided: the provider is paid €35.00; the rest goes back to the customer." and "The van arrived about 45 minutes late and one box was damaged, but the move was done and the late arrival was communicated. The provider gets half of the price; the customer gets the other half back." Only "Open chat" button. No appeal button, no review button, no reference number, no deadline for appeal, no date when the money moves (not shown).
- Home banner: "A problem was reported for a booking. Our team is looking into it; nothing is paid out until it decides." still shown (not updated to the decision). No separate "decided" notice seen on Home.
- Review: no review control on the booking page or on Home (text search for review/appeal: none). Could not write a review for J3.
- Provider J1 (ff0239dc-71d7-4143-9221-da5b3b57a2de): heading "Payment pending: it is being processed.", Quote TEST-Q-0988F5C3-2026-0001, €84.00, buttons "Open chat", "Scope/quote review". No payout amount shown, no earnings view.
- FLOW RATING dispute outcome (customer): 3/5 (decision and split are stated, but the heading and Home banner are stale and there is no appeal or review path).
- FLOW RATING review: 1/5 (not found).
