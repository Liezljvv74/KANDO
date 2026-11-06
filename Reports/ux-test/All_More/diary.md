# All_More diary (liezljvv74+allmore@gmail.com, AllMore Tester, Berlin 10119)

## Turn 1: sign up as provider, provider set-up

### Step 1: Open the app and start sign-up
- Browser cleared storage (sign-out step), opened http://localhost:8082. Landed on /welcome.
- Welcome screen shows: "FINALLY Someone who can", buttons "I need help", "I offer my skills", "Learn more", language switch (English).
- Taps: 1 (I offer my skills).

### Step 2: Create the account (sign-up form)
- Path: welcome > "I offer my skills" > /sign-up?offer=1 (form titled "Create account").
- Filled First name "AllMore", Surname "Tester", Email, Postcode 10119, Password (label "Password (At least 8 characters)").
- Found "I offer a service" already ticked (came in through the offer link, ?offer=1). I did not know that from the screen; my first tap un-ticked it, so I tapped again to tick it back. Taps: 2. Friction: the checkbox state is not obvious at a glance (only a small "✓" shows when on).
- Profile picture: tapped the round "Profile picture" button, sheet with Camera / Choose photo / Cancel. Chose "Choose photo". PLACEHOLDER USED (red toast "TEST HARNESS: placeholder file used"). Picture shown with a "Change profile photo" button under it. Helper text: "Providers see who they are working for. A picture keeps both sides safer."
- Ticked "I am at least 18 years old and accept the Terms and Conditions and the Privacy Policy." (no visible tick state in snapshot, I could not confirm it was ticked before submitting; submit went through, so it was).
- Tapped "Create account". Went to /verify-email: "Check your email. We sent a 6-digit code to liezljvv74+allmore@gmail.com." Field "Enter code", "Confirm email", "Send a new code", "Back to log in".
- Taps for this step: about 8 (excluding fields).

### Status at end of part 1
- Waiting at the email code screen. NEED EMAIL CODE for liezljvv74+allmore@gmail.com. Browser session left on /verify-email (not logged out, so the code can be entered in the same session).

### Step 3: Email code (resumed)
- Entered code 588656 on /verify-email, tapped "Confirm email". Landed on /my-profile?welcome=1 ("My business" tab, "Let's set up your service profile"). No separate "welcome" step, straight into the profile.
- Confusion: the top banner still says "Add your picture so providers can recognise you" with "Add picture" even though I had picked a placeholder photo at sign-up. The avatar "AllMore T." is shown below. PLACEHOLDER USED earlier.
- Live switch is disabled; text "Fill in the fields marked * below to go live." Status "Draft: not visible to customers".

### Step 4: About you
- Path: My business > "Edit: About you" pencil. Fields: Provider type (Private person or business), About you (optional), Strengths *, Skills *, Experience, Postcode *, Service radius (km) * (default 25), Also work remotely.
- "Add strength"/"Add skill" buttons stay disabled until text is typed. Chips appear after typing; no explicit Save button on this screen. Went back with "Back" and it saved (summary shows "Strengths: 1"). Verified after reopening: Strengths 1, Skills 3 (Moving help, Dog walking, Photography).
- Friction: I could not tell that the skills were saved until I reopened the page; no save confirmation. The Photography skill only committed after I left the field (I did not press a button).
- Taps: ~10.

### Step 5: Add 3 services
- Path: My business > "Add service" (plus icon). Form "New service": Category *, Title, Description, Price type *, Price (EUR) *, Remove.
- Service 1: Photography, Fixed price 120, title typed "Portrait and event photos". Saved card shows title "Photography" (my title was not shown on the card). Document needed shown on the form: "Photo ID (ID card or passport)".
- Service 2: Moving & house clearance, Per hour 35, title typed "Van help for moves". Card shows "Moving & house clearance  €35.00/hr" (again my title not used).
- Service 3: Dog walking, Fixed price 20, title "Dog walks in Mitte". Documents needed: "Photo ID (ID card or passport), Permit from the local authority". Card shows "Dog walking €20.00". Friction: I did not know the permit requirement before choosing the category; the warning only appears after picking it.
- Friction: "Add service" then Back saves; no explicit Save button; category sheet stays visually behind for a moment; price type sheet closes on tap.
- Taps per service: ~8-9. Strictly the category list has 'Photography, DJ, Catering, Digital services, Marketing, Management & consulting, Dog walking, Babysitting, Cleaning, Moving & house clearance, Assembly, Gardening, Small repairs, Other services'. 'Moving' is called "Moving & house clearance", not "transport" (I did not find a separate transport category).
- Service area: no separate screen found; it is the postcode 10119 and "Service radius (km) 25" inside About you.

### Step 6: Required documents
- Path: My business > "Verification documents" > "Required documents (0/1)" then 0/2 after Dog walking. Each row "Add: ..." opens a sheet with "Upload document", "Scan with the camera", "Choose from gallery", "Cancel".
- Photo ID: Add > Choose from gallery. PLACEHOLDER USED. Status went to "Waiting for check" ("06/11/2026: Waiting for check") after ~3 s. Cards then read "Waiting for document check: Photo ID (ID card or passport)".
- Permit from the local authority (for Dog walking): Add > Choose from gallery. PLACEHOLDER USED. Status "Waiting for check".
- Confusion: the section header still says "Required documents (0/2)" while both are "Waiting for check". Not clear whether "0" means approved. Also "Upload document" and "Choose from gallery" look the same to me.
- Taps: about 12.

### Step 7: Personal data (Account tab > My data)
- Path: Account tab. Section "My data": photo, "Scan your ID card to fill in your details" (AI reads the photo, shown with a line saying the photo is not saved), First name, Surname, Date of birth, Street and number (optional), Postcode, City (optional), Save.
- Date of birth: typed 1990-06-20 (ISO, as asked). Friction: no placeholder hint showing the format; I used the format from the brief.
- Street Rosenthaler Strasse 40, City Berlin. Tapped Save, "Saved" appeared under the button.
- Taps: about 6.
- Note: the Account page also shows "Admin panel (test version only)" link. I did not use it.
- Note: "I want to provide a service" switch on the Account page is already on.

### Step 8: Tax number and invoice consent (My business)
- Path: My business > "Tax number ▾" (expands: "Needed if you are a small business (Kleinunternehmer) or a business without a VAT ID: it is printed on your invoices."). Typed DE987654321.
- Switch "The platform issues invoices and receipts for my jobs in my name." turned on. Text above: "Before you can send quotes and accept bookings, agree that invoices are issued in your name."
- Friction: no Save button for the tax number; it showed "Tax number: DE987654321" after the payout step, so it was stored. Consent switch state is only visible as a switch, no wording of what I agree to beyond the one line.
- Taps: about 4.

### Step 9: Payout set-up via Stripe (new tab)
- Path: My business > "Set up payouts" (Not finished yet). Opened a Stripe tab titled "[Test] EfficientLife sandbox | Set up payments with Stripe". Note: the company name on the Stripe page is "EfficientLife sandbox" and the Stripe text says "uses Stripe for secure payments" - I did not know which company I was dealing with (it is the platform's Stripe account name, shown as the business name). Confusing for a provider.
- Phone step: I typed +49 15123456789. Verification code screen "Incorrect verification code." for 000000 (typed, pasted, typed slowly, resent twice, two different numbers). Shown code text was not visible on that screen at first. The phone step only worked after "Use test phone number" (button on the phone screen "Skip this with a test phone number."). After that Stripe showed "Use the code 000000 to successfully continue" with a "Use test code" button, and then it accepted it. (Blocker that cost ~15 tool steps; the brief's "any +49 with 000000" did not work for me.) Note: the Stripe test-number button is inside the Stripe page; I used it as a real user would. Placeholder number shown as "1512 3456789".
- Individual: business type was pre-selected as "Privatperson (Einzelunternehmen) / eingetragener Kaufmann/-frau (e.K.) / Kleingewerbetreibender / Freiberufler / o.ä.", Germany. Continue.
- Personal details: first name AllMore, last Tester, DOB 20/06/1990 (day/month/year boxes, not the yyyy-mm-dd format used in the app), address Rosenthaler Strasse 40, 10119, Berlin.
- Business details: website field; used "Don't have a website? Add product description instead." Product description typed. Continue.
- Payout: Germany, IBAN DE89370400440532013000 entered twice (IBAN and Confirm IBAN). Continue.
- Review: "Incomplete" on Personal details. Edit > "Start verification" > Stripe ID check > "Simulate" > "Successful verification" > Submit result. Then "Agree and submit". Stripe said to return to the app.
- Stripe redirected to a page on the website (localhost:3000/payout-done): "Almost done. If you finished the payout set-up, the app shows it in a moment..." with "Back to the app".
- In the app: "Set up payouts: Your payouts are set up." Tax number DE987654321 shown. Invoice switch on.
- Taps: about 45 (incl. phone step retries).

### Step 10: Status after payouts
- My service profile: Live switch is still disabled and "Draft: not visible to customers". Services show "Waiting for document check" for all three. Required documents (0/2). This is where staff approval is needed.
- Result: WAITING FOR STAFF. Not able to go Live yet.

## Turn 2

### Step 11: Sign in again
- Browser had been logged out. Landed on /welcome, tapped "Log in/Register", typed email + password, "Log in". Went to Home. ~6 taps. Fine.
- Home shows a banner: "Your payouts are set up. Agree to invoicing on the payout card before you send quotes and accept bookings." with ×. Confusing: I had already switched on the invoice consent on My business, and the banner says to agree "on the payout card". I did not find a payout card with an agree button.

### Step 12: Did the app tell me about the document approvals?
- No message, notification or banner about the approval that I could find on Home or My business. I only saw it when I reopened My business: the three services no longer said "Waiting for document check", and "Required documents" changed from (0/2) to (2/2). The change was silent. (Notifications exist in Account, but nothing new came up there; I did not check the notification list itself.)
- Friction: silent state change, I had to go and look.

### Step 13: Services now
- Dog walking €20.00, Moving & house clearance €35.00/hr, Photography €120.00. Waiting texts gone. Verification documents: Required documents (2/2), Optional (0/3).

### Step 14: Try to go Live
- Live switch on My business: disabled. Text: "Fill in the fields marked * below to go live." No field shows an error or a red asterisk; I could not see which field.
- Tried: opened About you (Edit). All starred fields look filled: Strengths 1, Skills 3, Postcode 10119, radius 25. The "Provider type *" dropdown showed "Private person or business" already, but it was never a real choice I had made. Opened it: options "Private" and "Business". Tapped "Private" explicitly, went Back.
- After that the line "Fill in the fields marked * below to go live." disappeared and the Live switch became tappable. Tapped Live: "Your profile is live. Tell people about it. Share". Profile status: "Published: visible to customers".
- Friction (important): the default text "Private person or business" looked chosen but was not saved as a value. A real user would not know to tap it. The app gave no message naming the field. Rating for this part: 2/5.
- Taps: about 12.

### Step 15: Customer search for providers (as customer, same account)
- Path: Search tab. Layout: "Find providers" (Category dropdown "All categories", Postcode, Search term (optional), Find), then provider cards. Category sheet lists radios; picking one closes it.
- Search with Category Cleaning and Postcode 10117 > one result: "All T. New Gardening · Cleaning · Assembly from €85.00 · ≈ 1 km". Before the filter the same card said "from €28.00" (no distance). The "from" price changed between the unfiltered and filtered list. Friction: unclear why.
- Friction: the Search tab also shows "My service profile" (my own provider card, Live switch and Share) below the results. A customer does not expect their own business settings on the search screen.
- Taps: about 10.
- Rating: 3/5.

### Step 16: Open the profile of All (Berlin 10117, provider)
- Path: tap All T. card > /provider/all-t.
- Shows: name "All T.", "New", "Verified", "Berlin", categories, "Checked documents: Photo ID", "Translate" (button), Strengths (Reliable and punctual, Friendly), Skills (Garden care, Hedge trimming), Experience (Six years of garden and home work in Berlin...), Services with price and action: Gardening "€28.00/hr" + "Request a quote"; Cleaning "€85.00" + "Book"; Assembly "€45.00" + "Request a quote" (two buttons "Book" and "Request a quote" are not explained). Good: "Checked documents: Photo ID" is a trust signal. Confusion: why Cleaning is "Book" and Gardening is "Request a quote" when prices are different types (hourly vs fixed).
- No reviews section and no rating visible on the profile (Past jobs / reviews absent). Asked myself "is this provider any good?" with nothing to go on.
- Friction: no back button text read in the page text. Screenshot: Reports/ux-test/All_More/provider-all-t.png
- Rating: 3/5.

### Step 17: Tabs and Home, Correspondence
- Tabs (bottom bar): Home, Search, Correspondence, My business, Account.
- Home: the banner about payouts (with ×), then two big buttons "I need help" (describe what you need, free) and "I offer my skills", plus "Learn more". Home is for choosing customer or provider mode, not a dashboard. Confusing: the same account is both, but Home does not show what needs my attention (no open requests, quotes, or messages).
- Correspondence: four rows "My requests and bookings", "Quotes", "Messages", "Invoices and receipts". My requests and bookings: tabs "As customer" / "As provider", then "Bookings" / "Requests", and "Nothing here yet." Empty as expected. I did not open Quotes/Messages/Invoices (empty; not tested in this turn).
- Friction: "Correspondence" name is not a word a user uses; "Messages" is buried one level down. Rating for tab structure: 3/5.
- Staff note: the provider and customer sides are on one account; there is no switch to show the customer view. "As customer" / "As provider" only inside bookings.

### Step 18: Log out
- Logged out via localStorage clear (same as start of turn).

## Turn 3

### Step 19: Sign in and find out about new requests and messages (as provider)
- Sign in: /login, email + password, Log in. Landed on Home.
- Home now shows notification cards above the two intent buttons: "You have a new message." (x2 plus "+2 more messages"), "You have a new request with a date, time and place. Send a quote or decline within 3 days.", each with × and "Open". No push exists, so these cards plus the tab badge are the only signals.
- Correspondence tab shows a red badge "4" (later "2"). Inside Correspondence, "My requests and bookings, 2" and "Messages, 2" carry counts. Quotes and Invoices have no count.
- Friction: the badge counts and the Home cards disagree (4 vs 3 cards). The cards stay on Home after I opened the request and sent a quote (the notification list did not clear). I had to remember what I had already done.
- Rating: 3/5.

### Step 20: Read and quote J3 (request 3381f8dd, Van help for moves, from All T.)
- Path: Home card "Open" > Correspondence > My requests and bookings > "As provider" > Requests list > "Open" card > /bookings/request/3381f8dd-...
- Request page: "Help moving: a sofa and boxes, with a van. About 2 hours.", "Requested: Nov 13, 2026, 10:00 AM (120 min)", "On site: 10117 Berlin" (street hidden until the booking), request text "Please tell me in chat if 2 hours is not enough.", "Answer by Nov 9, 2026, 1:33 PM".
- Chat (Open chat, thread header "All T."): All asked whether I bring a van and whether EUR 35/h is with one or two helpers. I replied: "yes, I bring a van, EUR 35 per hour for me with one helper, two hours is fine, I will send a quote for EUR 70 (2 hours)." Send button enabled only after typing. Sent at 1:35 PM.
- Quote: Amount in euro 70, Scope of the work (typed "Van with one helper, 2 hours (EUR 35 per hour x 2) for a sofa and boxes. Loading and unloading included."), "Date and time confirmed" switch already on, Date 2026-11-13, Time 10:00, Duration 120 (pre-filled from the request). "Send a quote". Result: "Quote sent", "€70.00", "Open · Valid until Nov 13, 2026, 10:00 AM".
- Friction: the quote is "valid until" the job date (so it expires at the start time of the job); no explanation. The quote form keeps the typed values after sending.
- Taps: about 12 for the quote, plus about 6 to find the request. Rating for quote flow: 3/5.

### Step 21: Read and quote J2 (request a9d58011, Photography, from Customer T.)
- Request: "Family portrait photo session (Photography), about one hour, outdoors in a park near Mitte... About 30 to 40 edited photos delivered as a download. Please tell me in your reply what is included and what the total price is..." Requested Nov 14, 2026, 2:00 PM (60 min), On site 10115 Berlin, "Happy to meet at Mauerpark".
- Conflict: the request text asks for 30 to 40 edited photos, but the brief I was given said I should say 20 edited photos. I followed the brief and answered 20 in chat and in the scope, but a real provider would see this mismatch in the request text and would have to decide. The app does not highlight it.
- Chat (thread "Customer T."): I answered: one hour session with 20 edited photos delivered as a download within a week; a second short session is a separate quote; extra prints not included.
- Quote: EUR 120, scope "Family portrait session, one hour, outdoors ... 20 edited photos ... Extra sessions or prints are a separate quote." Result "Quote sent", "€120.00", "Valid until Nov 13, 2026, 1:37 PM".
- Friction: "Answer by Nov 9" and quote validity ends the day before the job; no way to set my own validity.
- Rating: 3/5.

### Step 22: Customer role (same account): J4 request to All
- Home > "I need help" opens Search (Find providers) directly. In customer mode the Search screen does NOT show my own provider card (it was shown in provider mode), so the roles are separated on that screen.
- Found All T. (Gardening · Cleaning · Assembly, Berlin). Provider page in customer mode shows "Book" on Cleaning and Assembly and "Request a quote" on Gardening. Tapped "Book" on Assembly (EUR 45): /bookings/new-request with the form.
- Form: "What needs to be done?", Date, Time of day, Duration (60 pre-filled), Street and number (pre-filled Rosenthaler Strasse 40), Postcode (10119), City (Berlin), Note (optional), Photos (optional), "Send request". The form gives no price field and does not say the price is fixed EUR 45 (I only saw it on the provider page). Note: the form text says "A quote is valid for 7 days", while the provider side shows an expiry on the job date.
- Filled: "Assemble one flat-pack wardrobe (two doors, about 2 metres high). Parts are in the box... Please bring your own tools." 2026-11-10, 10:00, 120 min. Sent.
- Result: request a66d312c-46a7-4dc2-b225-91d88f5ac531, "Open", "Answer by Nov 9, 2026, 1:38 PM", "Quotes: No quote yet.", button "Withdraw request".
- Chat: thread 981f0b7e-042e-4c5d-b0b9-4eb59aaa7310 with "All T.": "Hello All, do you have your own tools for the wardrobe, and is the EUR 45 fixed price for the whole job including the bag of screws?" Sent 1:38 PM. No reply yet.
- Taps: about 14 for the request.
- Rating for request flow: 3/5 (no price shown on the form; roles clear).

### Step 23: How the two roles are separated
- Same login, two modes. Evidence: Search in provider mode shows my own "My service profile" card under the results; in customer mode it does not. My requests and bookings has "As customer" (disabled = selected) and "As provider" switches. Home cards mix both: new messages and requests (provider side) appear on the customer-facing Home.
- Friction: no obvious switch from one role to the other on Home; I moved between them by using the tab names and the "I need help" button. Rating: 2/5.

### Step 24: Log out
- Logged out via localStorage clear.

## Turn 4 (J2 additional task, J3 finish)

### Step 25: Learn of the J2 additional task
- Sign in OK. Home shows the card "An additional task was requested for a booking." (above "A booking was paid. The appointment is confirmed." and "The customer accepted your quote..."). Badge on Correspondence "9", later "5".
- Tap "Open" > /bookings/request/d1fcaa1f-6f7d-492f-8c60-fb6e6f710ac1 titled "Additional task for a booking". Clear: the title says it is for a booking; text: "Could I add 10 more edited photos ... on top of the 20 that are included ... 2 printed copies" and "Work on the additional task starts only once it is accepted and paid. Until then, only the original job is owed." Good.
- Not clear: the request page does NOT link to the original booking (33b3bd4f-...). I could not see the original booking from this page; I had to go to the chat.
- Chat (thread 23e2c1cb-933b-41e0-a17a-90a89e62f9f7, same thread as J2): the thread shows the original history together with the new card: "Quote: €120.00 (version 1)", "Quote accepted: €120.00", "Additional task requested". So original and additional are visible together in the chat only. Good.
- Answered in chat: yes, 10 more edited photos and 2 printed copies, EUR 45 total, delivery within 3 days after the photo choice. Sent.

### Step 26: Quote for the additional task
- Quote form on the request page: Amount in euro, Scope of the work, Date and time confirmed (switch off by default for this one), and the note "The quote will say the date and time are still to be confirmed with the customer." Entered 45 and a scope text. "Send a quote" > "Quote sent", "€45.00", "Date and time still to be confirmed", "Open · Valid until Nov 13, 2026, 2:00 PM".
- Clear: the form asks for the extra price, the note explains the date. Less clear: the validity ends at the original appointment time (Nov 13, 2 PM) with no explanation of why.
- Taps: about 10. Rating for the additional task flow: 4/5 (clear that it is additional; the missing link to the original booking is the gap).

### Step 27: Finish J3 (van job, booking cf70bef7-1468-4646-94f0-2839afa3834e, paid EUR 70)
- Path: Correspondence > My requests and bookings > As provider > "Bookings" list. The bookings list shows two rows, both "Nov 6, 2026, 10:56 AM Paid and confirmed", with no job title: I had to open the first, which was the van job (Kastanienallee 12). Friction: the bookings rows do not say which job is which. Rating: 2/5 for finding it.
- Booking page: "Paid and confirmed", "Quote TEST-Q-3A792693-2026-0001", "Time: Nov 6, 2026, 10:56 AM (120 min)", "Amount: €70.00", "Place: On site: Kastanienallee 12, 10117 Berlin", buttons: "Open chat", "Job finished", "Scope/quote review" (disabled), "Stop the job" (disabled), "The other side did not turn up" (disabled).
- Tapped "Job finished". Panel text: "The customer then has 7 days to confirm or report a problem. Without an answer the payment is released after the 7 days." Field "Of which material costs, in euro (optional)" and button "Mark as finished". No photo or receipt field on this screen. I left the material costs empty and tapped "Mark as finished".
- After: "You marked the job finished. The payment is released on Nov 13, 2026, 2:00 PM unless the customer reports a problem." Buttons now: "Open chat", "Report a problem", "Scope/quote review".
- Note: the release date (Nov 13, 2 PM) is the job date shifted; the test setup moved the dates, so ignore the date value itself, but the wording "7 days" is what the app says.
- Invoices: Correspondence > Invoices and receipts shows "You have no invoices or receipts yet. They appear here once a booking is settled." So nothing for the J3 invoice yet (the invoice appears only after release). Rating for the finish flow: 3/5 (clear once found; material costs/photos/receipt are not asked; "7 days" wording is clear).

### Step 28: Customer-side check of J4
- Customer list (As customer) shows my request a66d312c "Assemble one flat-pack wardrobe..." with the status "Declined". All has declined it. Good: the decline is visible on the customer side as a status on the request card.

### Step 29: Log out
- Logged out via localStorage clear.

## Turn 5 (J3 dispute as provider, J2 finish)

### Step 30: Learn of the problem report (J3)
- Sign in, Home card first: "A problem was reported for a booking. Our team is looking into it; nothing is paid out until it decides." Badge "7". Open > /bookings/cf70bef7-... Heading "Being reviewed by our team", status box "Under review".
- Text I can read: "The customer reported a problem with the job." plus All's full text (van 45 min late, one cardboard box damaged, job not confirmed, asks the team to look before payment). "Our team decides by Nov 26, 2026, 2:08 PM. No money moves until then."
- Clear: who decides (team), deadline, nothing paid. Not clear: whether I can answer the report itself. The booking page has only "Open chat" (no respond/answer button, no evidence upload).
- Rating: 4/5 for clarity of the status and deadline; 2/5 for the reply route.

### Step 31: Reply to the report
- The problem text is NOT in the chat thread 93617339-... (the chat shows only the earlier messages and quote). So the customer's words are only on the booking page.
- Tried the chat: typed and sent "Hello All, I am sorry that I was late. I would like to talk about the damaged box. Could you send me a photo of it and tell me what you need? I have also seen your report in the booking." Sent 2:09 PM; it appears in the chat. There is no link to say the reply is linked to the report.
- No "respond" or "dispute" button on the provider side. Nothing about how my reply reaches the team.
- Did not try to resolve it.

### Step 32: J2 photo session finish (booking 33b3bd4f-4dd4-4368-b821-8b16b47ef0a2)
- Booking shows "Quote TEST-Q-3A792693-2026-0002", "Paid and confirmed", 60 min, EUR 120, Torstrasse 100, 10115 Berlin. Actions: Open chat, Job finished, Scope/quote review, Stop the job, The other side did not turn up.
- Job finished > "Of which material costs" (left empty) > Mark as finished. Result: "You marked the job finished. The payment is released on Nov 13, 2026, 2:10 PM unless the customer reports a problem."
- Taps: about 5. The booking page does not show the additional task linked to it.

### Step 33: J2 additional task finish (booking 3a01258d-c663-4062-aa51-b2235b537445, EUR 45)
- Booking title "Additional task", "Paid and confirmed", same time and place as the original (Torstrasse 100, 10115 Berlin). Text: "Work on the additional task starts only once it is accepted and paid. Until then, only the original job is owed." Clear it is an extra of the same job by the title and the same place; no explicit link to the original booking.
- Job finished > Material costs typed 8 > Mark as finished. Result: "You marked the job finished. The payment is released on Nov 13, 2026, 2:11 PM unless the customer reports a problem." The EUR 8 material cost is NOT shown anywhere afterwards on the booking (it disappears; no line for costs, no net amount).
- Taps: about 6.

### Step 34: Earnings, commission, invoice
- Invoices and receipts: "You have no invoices or receipts yet. They appear here once a booking is settled."
- Commission invoices: "You have no commission invoices yet. KANDO sends you one each month in which it kept commission."
- No earnings total, no net amount after commission, no view of the EUR 8 material cost, and no link from the bookings to the money. My business shows nothing on money except payouts status.
- Rating: 2/5 (cannot see what I will receive).

### Step 35: Log out
- Logged out via localStorage clear.

## Turn 6 (J6 dog walk, money screens)

### Step 36: Sign in and tabs
- Sign in OK. Right after login the bottom bar first showed only Home, Search, Correspondence, Account (no "My business", no badges). A few seconds later the full bar appeared with "9" on Correspondence. Friction: looked like the provider side had disappeared for a moment; it was a loading state. Rating 2/5 (a real user would panic).
- Home cards: "You have a new message.", "You have a new request with a date, time and place. Send a quote or decline within 3 days.", "A problem was reported for a booking...", "+13 more messages". The Home screen also showed the Account page text in one render (stale content) - a rendering glitch.

### Step 37: Learn of J6 (request c2bcca55-8585-42ac-a5dd-4f7b9a54d899)
- Route: Home card "You have a new request..." > Open > request page. Request text: "Dog walk for my dog Bruno... One walk of about 45 minutes around Mauerpark... avoid building sites and busy streets... I will leave the lead and a treat bag at the door." Requested Nov 8, 2026 10:00 AM (45 min), On site 10115 Berlin. "Answer by Nov 9, 2026, 3:09 PM".
- The request form pre-fills "Amount in euro" with 20 and Duration 45, and "Date and time confirmed" is on. The 20 comes from my Dog walking service price (fixed EUR 20). So the form copies the service price; it does not say that the price is per walk or per hour. Clear enough for a fixed-price service; unclear whether a 45 min walk should be priced differently.

### Step 38: Chat reply
- Thread 21d52c37-bc9d-4ad0-a848-450fd103e07a with "Customer T." Customer message: Bruno is on a lead the whole time, afraid of loud noises, quiet route around Mauerpark, lead and treat bag by the front door, asks me to confirm 10:00 Sunday.
- I replied: yes, 10:00 Sunday, lead the whole time, quiet route around Mauerpark, away from building sites and busy streets, will message if running late, 45 min, quote EUR 20. Sent 3:12 PM.

### Step 39: Quote EUR 20
- Scope field empty by default. Typed "One dog walk, 45 minutes, on a lead, quiet route around Mauerpark. Pick-up at the front door, lead and treat bag provided by the customer." Send a quote. Result: "Quote sent", "€20.00", "Suggested time: Nov 8, 2026, 10:00 AM", "Open · Valid until Nov 8, 2026, 10:00 AM".
- Friction: the quote is valid only until the walk starts; no field to set validity; the scope shown on the quote is my text, so the 45 min is in the text only.
- Taps: about 8 for the quote and chat reply each. Rating 3/5.

### Step 40: Earnings, commission, invoices
- My business: sections are Live/profile, Set up payouts ("Your payouts are set up.", Tax number, invoice switch), Services, About you, Past jobs, Verification documents, Invoices and receipts, Commission invoices, and the CSV export. No earnings total, no pending payout amount, no release dates list, no commission percentage anywhere on this screen. Searched the screen text for commission/earn/%/payout: only "Commission invoices" and the payout status line.
- Invoices and receipts: still empty ("You have no invoices or receipts yet. They appear here once a booking is settled.").
- Commission invoices: "You have no commission invoices yet. KANDO sends you one each month in which it kept commission." So commission is only invoiced monthly after the fact.
- Commission rate: not shown before taking a job, not on the request page, not on the quote form. Only the sentence above.
- Rating for money visibility: 1/5 (cannot see income, release, or commission before or after).

### Step 41: Log out
- Logged out via localStorage clear.

## Turn 7 (J6 paid and finished)

### Step 42: How I was told it was paid
- Sign in, Home card "A booking was paid. The appointment is confirmed." (above "The customer accepted your quote. If no date and time was set yet, please agree it in the chat." and "You have a new message."). Badge 11. Card text does not name the booking or the amount; tapping Open goes straight to booking c8747afb-c36e-47df-83c4-5a5d6a945474.
- Booking page then shows "Paid and confirmed", "Quote TEST-Q-3A792693-2026-0003", 45 min, EUR 20.00, Torstrasse 100, 10115 Berlin.
- Rating: 4/5 (clear, one tap). Note: card does not say which job (friction if several paid at once).

### Step 43: Mark J6 finished
- Job finished > "The customer then has 7 days to confirm or report a problem. Without an answer the payment is released after the 7 days." > Material costs left empty > Mark as finished.
- Screen after: "You marked the job finished. The payment is released on Nov 13, 2026, 3:18 PM unless the customer reports a problem." Buttons: Open chat, Report a problem, Scope/quote review.
- Taps: 4. Rating 4/5.
- Note: the release date displayed is 7 days after the (test-shifted) finish time; the screen text itself says "7 days" in the form and the exact date on the result screen.

### Step 44: Log out
- Logged out via localStorage clear.

## Turn 8 (J6 completed: review, money, public profile, notes)

### Step 45: Learn of the completion
- Sign in. Home cards: "Your invoice or receipt is ready. You can download it in the app.", "How did the job go? Write a review within 7 days.", "The payment for a completed job has been made." Badge 14. Three cards at once, none names the job; "Open" on the review card goes to the booking. Rating 3/5 (clear, but three cards with no job name).

### Step 46: Review the customer (booking c8747afb)
- Booking page: heading "Completed", a receipt row "Receipt TEST-3A792693-2026-0001, Nov 6, 2026 · €20.00" (tap opens a PDF download), then "Review": "How did it go? The other side sees your review once both are in, or 7 days after the job.", five stars (radio buttons "1 star"..."5 stars"), "A few words (optional)", "Send review", and "The other side's review: The other side's review shows once both are in, or after 7 days."
- Tapped 5 stars, typed "Friendly customer, clear instructions, easy to work with.", Send review. Result: "Your review" ★★★★★ with my text and "Your review is final." 
- Clear: the visibility rule is written on the form. Not clear: whether the stars count before the other side reviews.
- Customer's review of me, shown on the same booking page: "The other side's review" ★★★★★ "Bruno was happy, quiet route, on time."
- Taps: 4 (open, star, text, send). Rating 4/5.

### Step 47: Invoices and receipts
- Invoices and receipts list: "Receipt TEST-3A792693-2026-0001 · To Customer Tester · Nov 6, 2026 · €20.00" (one row, J6 only).
- Opening it downloads "TEST-3A792693-2026-0001.pdf". Contents (read from the PDF):
  - Title "Quittung (Receipt)", Number TEST-3A792693-2026-0001, date of issue 06.11.2026.
  - From: "AllMore Tester, 10119 Berlin". To: "Customer Tester, Torstrasse 100, 10115 Berlin".
  - Service: "One dog walk, 45 minutes, on a lead, quiet route around Mauerpark. Pick-up at the front door, lead and treat bag provided by the customer.", service date 6.11.2026.
  - Arbeitskosten (Labour) 20,00 €, Material 0,00 €, Betrag (Amount) 20,00 €, Summe (Total) 20,00 €.
  - "Ausgestellt im Namen und für Rechnung von AllMore Tester durch KANDO / Issued in the name and for the account of AllMore Tester by KANDO".
  - Watermark "TESTDOKUMENT / TEST DOCUMENT".
  - NOT on the receipt: my tax number (DE987654321), any VAT or Kleinunternehmer wording, commission, net amount, platform fee, payout date.
- Rating: receipt clear for the customer; for me, 2/5 (no commission, no net).

### Step 48: Commission invoices
- "You have no commission invoices yet. KANDO sends you one each month in which it kept commission." Nothing for J6 yet. No commission rate or amount shown here or before.

### Step 49: Money on the booking and elsewhere
- Booking after completion: "Completed", receipt, review. No payout amount, no release date line, no commission line on the booking.
- Earlier, after "Mark as finished": "The payment is released on Nov 13, 2026, 3:18 PM unless the customer reports a problem." That is the only release information. The app never says how much I will receive (no net after commission), and no screen shows the commission percentage before I take a job.
- Home card "The payment for a completed job has been made." appeared (not opened in detail).

### Step 50: Public profile
- /provider/allmore-t (my public profile as a customer would see it): "AllMore T. Verified Berlin", categories, "★ 5 of 5 (number of reviews: 1)", "Checked documents: Photo ID, Permit", strengths, skills, experience, services with prices, and "Reviews: ★★★★★ · 11/6/2026 Bruno was happy, quiet route, on time." 
- Service names on the public profile are my typed titles ("Portrait and event photos", "Van help for moves", "Dog walks in Mitte"), but on My business the same services show the category names ("Photography", "Moving & house clearance", "Dog walking"). Inconsistent.
- My own review of the customer is not shown on my profile (only reviews of me).
- Rating now visible on the public profile and in Search (★ 5 of 5 after one review). Rating 4/5 for showing it.

### Step 51: Honest notes on the whole experience so far (provider and customer roles)
- What worked well: the sign-up and provider set-up are long but each step is explained; the request and chat flow is clear; quotes are simple; the "additional task" is labelled clearly; status words (Under review, Completed, Paid and confirmed) are plain; the review rule is written on the form.
- What frustrated me most: (1) money: I never see my net amount, commission, or when exactly I get paid except one release date after finishing; no commission rate before I accept a job; the receipt has no tax or VAT wording; (2) notifications: Home cards do not name the job, and they stay after I act; the badge counts do not match the cards; (3) the bookings list has rows with no job title; (4) the provider side briefly disappeared after login (tab bar); (5) the "Add picture" banner stayed after a photo was set; (6) the service title I type does not show on My business but does show on the public profile; (7) the Stripe payout set-up needed the test-number workaround and a Stripe page named "EfficientLife sandbox"; (8) the "EUR 8 material cost" I entered on the additional task disappeared from view.
- Role separation: one login, two modes; Search in provider mode shows my own card, in customer mode it does not; requests and bookings have "As customer / As provider" toggles. The bottom bar is the same, so a user can't tell which role a screen is in except by the page content.
- Overall: the core job cycle works end to end (request, chat, quote, pay, finish, review). The biggest gap for a provider is knowing what I earn and when.

### Step 52: Log out
- Logged out via localStorage clear.

## Turn 9 (German check, final feedback)

### Step 53: Switch to German
- Where: Account tab > "Language: English ▾" (also on the Log in page). Dialog "Language" with radios "Deutsch" / "English". One tap, then close.
- Persists after reload (checked on /search). Switched back to English at the end.
- Right after switching, the Account screen still showed some English labels (Street and number, Postcode, City, Export as JSON, Notifications, Chat messages, Reminders, the AI-info sentence stayed English until I navigated away and back). After navigation everything was German. Friction: partial re-render.

### Step 54: German texts, key screens (quotes exact)
- Home: "ENDLICH / jemand, der’s kann", "GEPRÜFT", "Eine Bewertung zu deinem Auftrag ist jetzt sichtbar.", "Deine Rechnung oder Quittung ist fertig...", "Wie lief der Auftrag? Schreib innerhalb von 7 Tagen eine Bewertung.", "Ich brauche Hilfe", "Beschreibe kostenlos, was du brauchst, ...", "Ich biete mein Können an", "Erstelle dein Profil ...". Mix of du and Sie: "Beschreibe" / "erhalte" (Sie-style imperative) next to "Schreib" / "Erstelle" and "Du kannst". 
- Search: "Anbieter finden", "Kategorie", "Alle Kategorien", "Postleitzahl", "Suchbegriff (optional)", "Suchen". Category names differ from the category list: "Gassi-Service" (Dog walking), "Umzug & Entrümpelung" (Moving & house clearance), "Management & Beratung" (Management & consulting). Card lines: "ab 28,00 €", "5 ★ (1)", "Neu".
- My business: "Mein Leistungsprofil", status "Online" in the header but "Veröffentlicht: für Kunden sichtbar" under the name. "Auszahlung einrichten", "Deine Auszahlung ist eingerichtet.", "Steuernummer: DE987654321", "Die Plattform stellt Rechnungen und Quittungen zu meinen Aufträgen in meinem Namen aus.", "Leistungen" (Gassi-Service 20,00 €; Umzug & Entrümpelung 35,00 €/Std.; Fotografie 120,00 €), "Über dich", "Privat", "Stärken: 1" (count, not the list), "Bisherige Aufträge", "Portfolio 0 von 12". Documents: "Nachweise zur Prüfung", "Erforderliche Nachweise (2/2)", "Optionale Nachweise (0/3)". Text: "Überlege, zusätzliche Dokumente einzureichen ... Deine Dokumente werden auf Echtheit geprüft, aber nie jemandem gezeigt." Mixed "Nachweise" and "Dokumente" for the same thing. Export: "Hol dir eine Tabelle (CSV) ...", "2026 als CSV exportieren", "Provisionsrechnungen".
- Bottom bar: "Start", "Suche", "Korrespondenz", "Mein Geschäft", "Konto" (all German, OK).
- Correspondence: heading "Korrespondenz"; rows "Meine Anfragen und Buchungen (8)", "Angebote (3)", "Nachrichten (4)", "Rechnungen und Quittungen". Quotes screen: "Angebote", "Gesendete Angebote", "Angebot TEST-Q-3A792693-2026-0003", "An Customer Tester", "Vorgeschlagener Termin: 08.11.2026, 10:00", "06.11.2026 · 20,00 € · Angenommen", "Anfrage öffnen". Note: the additional quote (EUR 45) is not in this list. Invoices: "Rechnungen und Quittungen", "Quittung TEST-3A792693-2026-0001", "An Customer Tester", "06.11.2026 · 20,00 €". Quittung vs English "Receipt".
- Booking J6 (c8747afb): "Zurück", "Buchungen" (title), "Angebot TEST-Q-3A792693-2026-0003", "Abgeschlossen", "Termin: 06.11.2026, 13:17 (45 min)", "Betrag: 20,00 €", "Ort: Vor Ort: Torstrasse 100, 10115 Berlin" (duplicated "Vor Ort:" and "Ort:"), then the English customer text "Please message me in chat if you are running late or cannot make it." (user content, not translated), "Quittung TEST-3A792693-2026-0001", "Bewertung", "Deine Bewertung", "Deine Bewertung ist endgültig.", "Bewertung der anderen Seite", the English review text "Bruno was happy, quiet route, on time.", "Chat öffnen". Term conflict on one screen: Buchungen / Angebot / Auftrag / Anfrage.
- Dispute J3 (cf70bef7): "Wird von unserem Team geprüft", "Angebot TEST-Q-3A792693-2026-0001", "Ort: Vor Ort: Kastanienallee 12...", the English request text "We need a van for a sofa and several boxes..." (untranslated), "Wird geprüft", "Der Kunde hat ein Problem mit dem Auftrag gemeldet.", the English customer report paragraph (untranslated), then "Entschieden: der Anbieter bekommt 35,00 €; der Rest geht an den Kunden zurück." followed by an English explanation: "The van arrived about 45 minutes late and one box was damaged, but the move was done and the late arrival was communicated. The provider gets half of the price; the customer gets the other half back." So the decision text is half German, half English, and it is shown as a decision (not as a proposal). Mixed language on the most sensitive screen.
- Review block: "Deine Bewertung", "Deine Bewertung ist endgültig.", "Bewertung der anderen Seite", text in English.
- Declined request (J4, customer view): "Anfragen", "Gewünscht: 10.11.2026, 10:00 (120 Min.)", "Vor Ort: Rosenthaler Strasse 40, 10119 Berlin", "Abgelehnt", "Angebote", "Noch kein Angebot." Chat message from All (English): "Hello, thank you for asking. I have to decline this one: I am fully booked on Tuesday 10 November. I am sorry, and I hope you find someone soon." No decline reason field, no alternatives.
- Overflow at 390 px: no horizontal scroll on /search and on the dispute booking (scrollWidth 390 = viewport). 

### Step 55: Back to English
- Account > Language > English. Done.

### Step 56: Final feedback written
- Reports/ux-test/All_More/feedback.md
