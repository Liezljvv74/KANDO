# Customer diary (test agent "Customer")

Viewport 390x844. Session started 6 Nov 2026.

### Step 1: Sign up from scratch (Turn 1)
- Path: welcome "Log in/Register" -> login "No account yet? Sign up" -> sign-up form. Taps: about 9 (link, 5 text fields filled in one form call, profile picture, Choose photo, terms checkbox, Create account).
- Form: First name, Surname, Email, Postcode, Password (labelled "At least 8 characters"). Left "I offer a service" unticked. Profile picture: sheet with Camera / Choose photo / Cancel. PLACEHOLDER USED (Choose photo).
- Expected: the "Create account" button is the only way forward, and the terms checkbox is a separate tick under the "I am at least 18 years old and accept the Terms and Conditions and the Privacy Policy" text. Easy to find. The profile picture is optional-feeling but there is no "skip" in the sheet; I picked a photo.
- Friction: the page is labelled "Create account" but the first screen after it is "Check your email", so no confusion. The language switch is at the bottom of every screen. Language left on English.
- Result: "Check your email / We sent a 6-digit code to liezljvv74+customer@gmail.com." Stopped here as instructed.
- Rating (sign-up, so far): 4/5. Quick, clear fields, no surprises.
- STATUS: NEED EMAIL CODE for liezljvv74+customer@gmail.com

### Step 2: Email code and first screen (Turn 2)
- Entered code 414134 on "Check your email", tapped "Confirm email". Went straight to Home, logged in. Taps: 2.
- Friction: Home shows a banner "Add your picture so providers can recognise you" with "Add picture" even though I picked a photo at sign-up (PLACEHOLDER USED). I did not know whether the sign-up photo had been saved. Rating 3/5.

### Step 3: Customer profile (Account tab)
- Path: Account tab -> "My data". Fields: First name, Surname, Date of birth, Street and number (optional), Postcode, City (optional), Save. Also an "Scan your ID card" button and an AI sentence above it.
- Friction 1: Date of birth is a native date box. I typed "14.06.1985" and pressed Save: it said "Saved" but the box came back empty. Typing "1985-06-14" worked. A real user would not know the format. Quote: "Saved" shown next to the Save button.
- Friction 2: the AI sentence "An AI service reads the photo once to suggest your name, date of birth and address..." sits in the "My data" section and is the first thing a customer sees when they just want to type. Unclear whether I must use it.
- Entered Torstrasse 100, Berlin, 10115 (Torstrasse 100 is the street in the brief). Taps: about 6.
- Rating: 3/5 for profile set-up (date format trap).

### Step 4: Find a gardener (Search tab)
- Path: Search tab -> category dropdown "Category: All categories" -> bottom sheet "Type to search" -> Gardening -> postcode 10115 -> search term "hedge trimming" -> Find.
- Friction: the category sheet is scrollable, and "Gardening" sits below the fold; I tapped the radio but it was off screen. Typing "Gardening" in the search box worked. Taps: about 9 (with two failed attempts).
- Before filtering, the list shows 12 providers, with All T. and AllMore T. at the top, plus e.g. Jürgen M. (Gardening · Small repairs, from EUR 35). After Gardening + "hedge trimming" + Find only "All T." came back ("Gardening · Cleaning · Assembly from EUR 28.00 · approx 2 km").
- Expected: Jürgen M. also offers Gardening but did not show up in the filtered results, and I did not understand why (distance? the search term?). Nothing on screen explains it.
- The "Find" button only shows results after a tap; the list did not refresh when I changed the category. Rating 3/5.

### Step 5: Compare providers and open a profile
- Opened All T. Profile: Verified, Berlin, "Checked documents: Photo ID", Strengths "Reliable and punctual", "Friendly", Skills "Garden care", "Hedge trimming", Gardening EUR 28.00/hr with "Request a quote", Cleaning EUR 85, Assembly EUR 45 with "Book".
- Good: the profile answers what I need quickly, and the price per hour is clear.
- Friction: I could not compare with Jürgen M. from the filtered list. I did not check his profile (I was not sure it was worth going back). AllMore T. does not offer gardening, so it was not a choice for this job.
- Rating: 4/5.

### Step 6: Request a quote from All (J1)
- Path: All T. profile -> "Request a quote" (Gardening) -> form "Request a quote". Taps: about 16.
- Form fields: What needs to be done?, Date, Time of day, Duration in minutes (prefilled 60), Street and number (prefilled Torstrasse 100), Postcode (prefilled 10115), City (prefilled Berlin), Note (optional), Photos for the provider (optional), Send request.
- Entered: hedge description (about 12 m privet and laurel, trim, tidy, take green waste away), date 11 Nov 2026 (Wednesday), time 10:00, duration 180, note asking for a cost and an answer in chat. Photo: "Choose photo" (PLACEHOLDER USED). Sent.
- Friction: the Date field only accepted "2026-11-11" (ISO), and "Time of day" was a free text box where I typed "10:00". A real user may expect a picker. The photo sheet is titled "Profile picture" even though it is for a job photo: wrong wording. Quote: "Profile picture".
- The "Send request" button stayed on a spinner for about 15 seconds before the page changed to the request page. No error. Rating 3/5.
- Result: "Requests" page, status "Open", "Answer by Nov 9, 2026, 1:22 PM", "No quote yet.", buttons "Open chat" and "Withdraw request". The request page does not show the photo that I added.

### Step 7: Chat with All (question before quote)
- Path: request page -> "Open chat" -> thread with All T. The first message is the request photo, with a time stamp.
- Typed the question: "Is 10:00 on Wednesday 11 November free for about 3 hours? ... is the price simply EUR 28 per hour in total, so about EUR 84 for the 3 hours?" Send. The message appeared right away with time "Nov 6, 2026, 1:23 PM".
- The request page shows no sign that All has read it. No answer yet.
- Rating: 4/5 (chat easy to find, fast).

### Step 8: Log out
- Cleared localStorage and went to the home page, as the briefing says. The Account tab's "Log out" button was not used, so this is a technical logout, not a user-visible one (the "Log out" button sits under the Account section).

## FLOW RATINGS (so far)
- FLOW RATING sign-up and verification: 4/5 - quick, the code screen is clear. Minus for the photo banner still showing afterwards.
- FLOW RATING profile set-up: 3/5 - date field needs ISO format, AI sentence is confusing.
- FLOW RATING finding a provider: 3/5 - category sheet hard to scroll, filtered list dropped Jürgen M. without explanation.
- FLOW RATING requesting a job: 3/5 - date only ISO, time as text, "Profile picture" sheet for a job photo, spinner long.
- FLOW RATING chat: 4/5.

### Step 9: Sign in again (turn 3)
- Cleared storage, Log in with the password. Landed on Home. Taps: 3. Rating 4/5.

### Step 10: J2 request to All_More (Photography)
- Search (no filter) -> AllMore T. profile. Services: "Portrait and event photos" EUR 120.00 with a "Book" button; "Van help for moves" EUR 35.00/hr and "Dog walks in Mitte" EUR 20.00 (with "Book"). Bottom button "Request a quote" (general).
- Used the general "Request a quote" at the bottom, not "Book" for Photography, because I wanted a quote and to ask what is included. The form has no service picker, so I named Photography in the description.
- Description: family portrait session, one hour, outdoors near Mitte, two adults and two children, 30-40 edited photos, asked what is included and the total price, and wrote "I might need extra things later (for example a second short session or a few extra prints), so please say how you handle extra requests." Date 2026-11-14 (Saturday), 14:00, 60 minutes, note about Mauerpark.
- Request id a9d58011-49ef-4b34-b3a9-6986826366d9, status "Open", "Answer by Nov 9, 2026, 1:25 PM", "No quote yet.". Send took about 8 s to change page.
- Chat: "Open chat" -> thread shows "No messages yet. Write the first one." Sent my question (what is included in the hour, delivery, price of a second session). Message appears at "Nov 6, 2026, 1:25 PM".
- Friction: no way to ask the provider before a request exists (no chat button on the profile). The "Book" vs "Request a quote" difference is not explained anywhere on the profile.
- Rating: 3/5.

### Step 11: J5 request to All (Cleaning, EUR 85 fixed)
- All T. profile: Cleaning EUR 85.00 with "Book". Tapped "Book".
- "Book" opened the SAME form titled "Request a quote" ("The provider answers with a quote, with or without a final date and time. A quote is valid for 7 days."). The fixed price EUR 85 is not mentioned on the form. So a fixed-price "Book" is still a quote request. The difference between "Request a quote" and "Book" is not explained on the page or the form. Quote: "Request a quote". Friction, rating 2/5 for clarity.
- Entered: 2-room flat move-out clean, 55 m2, second floor, no lift. Date 2026-11-17 (Tuesday), 09:00, 240 minutes. Note: EUR 85 fixed price is fine, confirm 4 hours in chat. Sent (no photo).
- Request id 9dec8060-faf8-4591-8c34-ba6600653102, status "Open", "Answer by Nov 9, 2026, 1:25 PM", "No quote yet.", buttons "Open chat" and "Withdraw request".

### Step 12: Correspondence (three open requests)
- Correspondence tab: four buttons: "My requests and bookings", "Quotes", "Messages", "Invoices and receipts".
- My requests and bookings: "Bookings" and "Requests" tabs. Requests are listed as the full description text with the status word "Open" at the end. No provider name, no date, no request id, no price. The three entries are told apart only by their first words; the cleaning one starts "Move-out clean...", the portrait one "Family portrait...", the hedge one "Our garden hedge...". Hard to find a specific one quickly.
- Quotes: "You have no quotes yet. They appear here once a quote was sent or received."
- Messages: three threads: "All T.", "AllMore T.", "All T.". Two entries are both labelled "All T." (the hedge request and the cleaning request), with no date or request reference to tell them apart. Quote: "All T.".
- Invoices and receipts: not opened.
- Rating: Correspondence 2/5 for finding a specific request or message.

### Step 13: Log out
- Cleared localStorage, went to home. Account "Log out" button not used.

## FLOW RATINGS (turn 3 additions)
- FLOW RATING requesting a job (J2 and J5): 3/5 - "Book" and "Request a quote" are the same form with no explanation; no chat before a request; forms still need ISO dates.
- FLOW RATING correspondence (finding requests, quotes, messages): 2/5 - long descriptions as titles, two "All T." threads with no reference.

### Step 14: Quotes arrived (turn 4, sign in)
- Sign in: Login page, email + password, Log in. Taps: 3.
- How I learned: Home shows banners "A quote is ready for your request. Confirm it to book; it is valid for 7 days." (x2) and "You have a new message." plus "+3 more messages", each with an "Open" button and "x" to close. Correspondence tab shows a red badge "6". The Correspondence list shows "My requests and bookings, 6" and "Messages, 3". Good: obvious.
- Quotes list ("Open quotes") shows three quotes: AllMore Tester "No service named" EUR 120.00 (Suggested time Nov 14 14:00, "20 edited photos ... Extra sessions or prints are a separate quote"); All Tester Cleaning EUR 85.00 (Nov 17 09:00, "Fixed price, 4 hours, own supplies"); All Tester Gardening EUR 84.00 (Nov 11 10:00, "3 hours at EUR 28 per hour").
- Friction: the Photography quote has no service name ("No service named") on the card, the accept dialog and the booking. Quote for J1 "Valid until Nov 11, 2026, 10:00 AM" (= the job day, not 7 days as the form promised). Quote for J5 valid to Nov 13.
- Negotiation: no counter-offer, no "ask for change" button. Only "Accept this quote" and "Open the request". The J2 quote said 20 photos; I had asked for 30 to 40. The provider's chat (opened after) confirmed 20 photos. I had read the 20 on the quote card and accepted anyway; the app did not warn me. Expected: a way to ask for a change, or at least a line "This quote differs from your request". Rating for negotiation: 1/5.

### Step 15: Accept and pay J1 (Gardening, EUR 84)
- Quotes -> "Accept this quote" -> dialog "Accept quote TEST-Q-0988F5C3-2026-0001 from All Tester? Service: Gardening. Price: €84.00. Time: Nov 11, 2026, 10:00 AM." -> "Yes, accept". Booking ff0239dc-71d7-4143-9221-da5b3b57a2de created, status "Waiting for your payment, pay by Nov 8, 2026, 1:39 PM" (before the job date; quote itself valid to Nov 11).
- "Pay now" opens Stripe Checkout in a NEW tab: "EfficientLife sandbox", "Booking on 11/11/2026, 10:00", EUR 84.00. The Stripe page shows Apple Pay, Klarna, Link, Amazon Pay, then Email, Payment method (Card, Klarna, Bancontact, MB WAY, More).
- Card: the Card row is hidden under its own accordion button, so a normal click failed; I had to open the card section with a script-like click (not a user action) and then type. Card number 4242 4242 4242 4242, 12/30, CVC 123, cardholder "Customer Tester", country Germany (preselected). NO postcode field appeared for Germany, so 10115 could not be entered. Quote-level detail for the report: the card number/expiry/CVC are in Stripe fields. Taps: about 25 (keyboard entry, one key per call, because the iframe fields could not be filled in one step).
- After Pay: Stripe showed "Processing", then the tab moved to localhost:3000/payment-done "Thank you. If you completed the payment, it is being confirmed now. In a moment you will see your booking as confirmed in the app. If you stopped the payment, you can pay in the app until the deadline." with a "Back to the app" link to skilled://bookings (does nothing in a browser). Return URL points to port 3000, not the app I was using (8082). Waited about 10 s.
- Back on KANDO booking (reload): "Paid and confirmed", "Time: Nov 11, 2026, 10:00 AM (180 min)", "Amount: €84.00", badge "Paid". Buttons: "Open chat", "Additional task", "Cancel the booking". No "what happens next" text on the booking screen. The app does not tell me what to do next.
- Rating: 3/5 for payment (fine in the end; return page and missing postcode are confusing). Taps: 6 in KANDO plus about 30 in Stripe.

### Step 16: Accept and pay J2 (Photography, EUR 120)
- Quotes -> "Accept this quote" -> dialog "Accept quote TEST-Q-3A792693-2026-0002 from AllMore Tester? Service: No service named. Price: €120.00. Time: Nov 14, 2026, 2:00 PM." -> "Yes, accept". Booking 33b3bd4f-4dd4-4368-b821-8b16b47ef0a2 "Waiting for your payment, pay by Nov 8, 2026, 1:43 PM".
- Same Stripe flow: "Booking on 14/11/2026, 14:00", EUR 120.00. This time the card fields could be filled by typing into the exposed fields in one step (fill). Card 4242. Paid. Booking shows "Paid and confirmed", "Time: Nov 14, 2026, 2:00 PM (60 min)", "Amount: €120.00".
- Rating: 3/5 (the "No service named" text is the main problem).

### Step 17: Accept, pay and cancel J5 (Cleaning, EUR 85)
- Accept dialog: "Service: Cleaning. Price: €85.00. Time: Nov 17, 2026, 9:00 AM." Booking 527499cb-3eff-49cf-9a13-53da2cafd2cb. Pay on Stripe: "Booking on 17/11/2026, 09:00" EUR 85.00, paid. Booking "Paid and confirmed".
- Cancel: "Cancel the booking" opens: "Cancelling now is free. You get the full price back; this can take a few days. Paid additional tasks of this booking are cancelled with it, by the same rule." Buttons "Yes, cancel" and "Keep the booking". (Before payment the same booking had a button "I no longer need this".)
- After "Yes, cancel": the page still said "Paid and confirmed" with the same buttons on the first look; after a reload the heading became "You cancelled in time. You get the full price back; this can take a few days." Only "Open chat" remains. No line about the provider being told, no cancellation reason field, no refund amount/date beyond "a few days".
- Friction: no immediate confirmation after cancel; the page did not update until reload. Rating for cancel: 3/5 (clear refund wording, unclear what the provider sees).

### Step 18: Booking screen, invoices, chat, additional task (J2)
- Invoices and receipts: "You have no invoices or receipts yet. They appear here once a booking is settled." (Paid but not done, so empty. Expected.)
- J2 booking: "Open chat", "Additional task" (button), "Cancel the booking". Tapped "Additional task": a panel "Work on the additional task starts only once it is accepted and paid. Until then, only the original job is owed." with a text box "What else should be done?" and "Start the additional task". I did NOT send anything. While this panel is open "Cancel the booking" is disabled. Close link at the bottom.
- Chat on J2 (AllMore T.): my question (13:25), provider answer (13:36): "Hello Customer, the one hour session includes 20 edited photos, delivered as a download link within a week. A second short session would be priced separately, as an additional quote that you can accept or decline in the app. Extra prints are not included." Then system lines "Quote: €120.00 (version 1)" and "Quote accepted: €120.00". I only saw this answer after accepting.
- Rating: booking page 3/5 (no next steps); chat 4/5; additional task discoverable 4/5.

### Step 19: Log out
- Cleared localStorage. Account "Log out" not used.

## FLOW RATINGS (turn 4)
- FLOW RATING quotes arriving and reading them: 3/5 - banners and badge are clear; "No service named" and the J1 quote expiry on the job day confuse.
- FLOW RATING accept and pay: 3/5 - accept dialog clear; Stripe card row hidden under its own button; no postcode field; return page says "Back to the app" with an app link that does not work in a browser.
- FLOW RATING cancel: 3/5 - refund wording clear ("You get the full price back; this can take a few days."); no provider notice shown, no immediate result.
- FLOW RATING booking after payment and invoices: 3/5 - "Paid and confirmed" clear; no next-steps text; invoices empty until settled.
- FLOW RATING negotiate or change a quote: 1/5 - not possible; only accept.

### Step 20: Additional task on J2 (turn 5)
- Sign in: 3 taps. Booking 33b3bd4f-4dd4-4368-b821-8b16b47ef0a2 opened.
- Changed since last time: the heading still says "Paid and confirmed", but "Time: Nov 6, 2026, 10:56 AM (60 min)" (was Nov 14, 14:00). The buttons are now "Open chat", "Additional task", "Stop the job" and "The other side did not turn up" (the earlier "Cancel the booking" is gone). I take it the provider has started the job. Nothing on screen explains this change. Also the J1 booking now shows the same "Nov 6, 2026, 10:56 AM" instead of Nov 11 10:00. Friction and possibly wrong: the booked date is lost.
- "Additional task" opens the panel: "Work on the additional task starts only once it is accepted and paid. Until then, only the original job is owed." Text box "What else should be done?" and "Start the additional task". While open, "Stop the job" and "The other side did not turn up" are disabled.
- Text I wrote: 10 more edited photos from the same session on top of the 20, plus 2 printed copies (10 x 15 cm) of two photos I choose, to be sent by chat after the first 20 are delivered; asked for the total price before the work starts and the delivery time.
- Taps: 2 to open, 1 to type, 1 to start: 4 taps. Clear.
- Result message: "Sent. You find the new request under Requests; its quote also shows in the chat."
- Status: Requests list shows the item with the full text as title, status "Open". Detail page: heading "Additional task for a booking", "Open", "Answer by Nov 9, 2026, 1:57 PM", "Quotes: No quote yet.", buttons "Open chat" and "Withdraw request". Request id d1fcaa1f-6f7d-492f-8c60-fb6e6f710ac1. It does NOT show the parent booking id or the original job.
- How the provider answers: the app says "its quote also shows in the chat"; the answer deadline is Nov 9, 1:57 PM. The customer is not told how the provider is notified.
- Chat from the booking (thread 23e2c1cb-...): a new system entry "Additional task requested" with "Work on the additional task starts only once it is accepted and paid. Until then, only the original job is owed." So the additional task is visible in the chat, but the chat entry has no link to the additional task. Cannot tap through from the chat.
- One view of what I owe in total: NOT available. The booking shows only the original job (EUR 120). The additional task sits separately in Requests with no total, no link, no "what I owe in total" line.
- Requests list also shows "+6 more messages" and banner "Payment due: the date and time are confirmed by both sides..." (from a different booking). Hard to tell which item belongs to which job.
- Rating: starting the additional task 4/5 (clear, few taps). Finding it afterwards and seeing the total 2/5.

### Step 21: Log out
- Cleared localStorage, went to home. Account "Log out" not used.

## FLOW RATINGS (turn 5)
- FLOW RATING additional task (request side): 4/5 - easy to find and start; the text box and "Start" are clear.
- FLOW RATING seeing original plus additional task together: 2/5 - no total, no link between the two.
- FLOW RATING chat link to additional task: 2/5 - the chat shows the event but cannot be opened from there.

### Step 22: Learn of the EUR 45 quote and accept (turn 6)
- Sign in: 3 taps. Home shows banners: "A quote is ready for your request. Confirm it to book; it is valid for 7 days.", "Your payment was received. Your booking is confirmed.", "Payment due: the date and time are confirmed by both sides. Pay by the date shown in the app.", "+10 more messages". Correspondence tab badge "4". How I learned: Home banner + badge. Clear. Note the banner does not name which booking.
- The Quotes list ("Accepted quotes", "My received quotes") does NOT show the EUR 45 quote. Only the Requests item does. I found it by opening Requests (Bookings list) -> "Additional task for a booking".
- Request page d1fcaa1f-6f7d-492f-8c60-fb6e6f710ac1: "Quote sent"; Quotes section: "€45.00 - 10 more edited photos from the same session and 2 printed copies (10 x 15 cm) of photos chosen by the customer. Delivery within 3 days after the photo choice." "Date and time still to be confirmed", "Open · Valid until Nov 13, 2026, 2:00 PM", button "Confirm quote". Helper text: "To change something, talk to the provider in the chat. They will send a revised quote, and you confirm it." That is a route to ask for changes: good.
- Taps: "Confirm quote" 1 tap. No confirmation dialog this time (earlier quotes had one: "Yes, accept"). Inconsistent. The app went straight to booking 3a01258d-c663-4062-aa51-b2235b537445 "Waiting for your payment, pay by Nov 8, 2026, 2:02 PM".

### Step 23: Pay the additional task (EUR 45)
- "Pay now" opens Stripe in a new tab ("Booking on 06/11/2026, 10:56", EUR 45.00). Same steps: email, open card section (script click), card 4242 4242 4242 4242, 12/30, CVC 123, name Customer Tester. Pay. Return page "Thank you ... being confirmed now". Closed the tab, reloaded KANDO.
- Result: booking 3a01258d "Paid and confirmed", heading "Additional task", "Amount: €45.00", buttons "Open chat", "Stop the job", "The other side did not turn up". No cancel button.
- Rating: 3/5 (again the Stripe card row needed a script click; payment itself fine).

### Step 24: How the original (EUR 120) and the extra (EUR 45) show together
- J2 booking 33b3bd4f: still "Paid and confirmed", "Amount: €120.00" only. No mention of the EUR 45 extra, no total (EUR 165), no link to the extra booking 3a01258d. Buttons: "Open chat", "Additional task", "Stop the job", "The other side did not turn up".
- Bookings list shows three rows "Nov 6, 2026, 10:56 AM Paid and confirmed" (J1, J2, extra). They have the same date and label; I cannot tell them apart without opening each.
- Invoices and receipts: "You have no invoices or receipts yet. They appear here once a booking is settled." Nothing per booking, nothing per extra.
- Total: not clear anywhere. Rating 1/5 for "total is clear".
- Next step on the booking: none written. The app does not say what happens next (when the work is done, when the invoice comes, when I confirm completion).

### Step 25: J1 (Gardening, All): anything waiting?
- Booking ff0239dc-71d7-4143-9221-da5b3b57a2de: "Paid and confirmed", "Time: Nov 6, 2026, 10:56 AM (180 min)", "Amount: €84.00". Buttons: "Open chat", "Additional task", "Stop the job", "The other side did not turn up". Nothing to confirm or pay for me. No notice reached me in Home banners; the Home list shows only "+10 more messages".
- Chat (thread d4081552-...): All's message at 1:29 PM: "Yes, Wednesday 11 November at 10:00 works for me... I am sending a quote with this. If the hedge needs more time, I will tell you in chat before I continue." Then "Quote: €84.00 (version 1)" and "Quote accepted: €84.00". Nothing new since acceptance. I did NOT see this message earlier (my earlier chat visit ended before the reply).
- Work not marked finished by All yet. No payment release or invoice yet.

### Step 26: Log out
- Cleared localStorage, went to home. Account "Log out" not used.

## FLOW RATINGS (turn 6)
- FLOW RATING learning of the extra quote: 4/5 - banner and badge; the request page is easy to find but not listed under Quotes (3/5 for that part).
- FLOW RATING accept and pay the extra: 3/5 - one tap accept; no dialog this time; Stripe card row friction again.
- FLOW RATING seeing the original and the extra together: 1/5 - no total, no link, no shared receipt; bookings list rows look identical.
- FLOW RATING J1 status: 3/5 - clear status, but no next step text and "Stop the job" buttons appear without explanation.

### Step 27: Learn that work is finished (turn 7)
- Sign in: 3 taps. Home shows three banners "The provider marked the job as finished. Confirm it or report a problem, otherwise the payment to the provider is made after 7 days.", "+14 more messages", Correspondence badge "6". Clear. These banners are the notice; no push here.
- Booking page for J1 (ff0239dc-...): heading "The provider marked the job finished. The payment to the provider is made on Nov 13, 2026, 2:07 PM unless you report a problem." Sub-line "7 days left to confirm or report a problem." Buttons "Open chat", "Confirm the job was done", "Report a problem", "Additional task".

### Step 28: Confirm J1 (Gardening, EUR 84)
- Tap "Confirm the job was done" -> dialog "Confirm the job was done? The payment to the provider is then released." with "Cancel" and "Yes, it was done". Tapped "Yes, it was done". 2 taps + 1 dialog.
- Result: heading "Payment pending: it is being processed." (about 10 s wait; buttons disabled while processing). No review button, no invoice.
- Note: the Home banner still says "marked the job as finished ... after 7 days" after I confirmed. Stale notice.

### Step 29: Confirm J2 (Photography, EUR 120) and the extra (EUR 45), one by one
- J2 booking 33b3bd4f-...: heading "The provider marked the job finished. The payment to the provider is made on Nov 13, 2026, 2:10 PM unless you report a problem." Confirm dialog same wording. Result "Payment pending: it is being processed." Taps: 3.
- Additional task booking 3a01258d-...: heading "The provider marked the job finished ... Nov 13, 2026, 2:11 PM unless you report a problem." Same dialog. Result "Payment pending: it is being processed." Taps: 3.
- The extra is a separate confirmation. Clear that it is a separate job, but the J2 confirmation did not cover it.

### Step 30: Reviews (J1 5 stars, J2 4 stars)
- Could NOT find a review form. Checked: J1 booking page (only Open chat / Additional task), J2 booking page, the extra booking, Bookings list, J1 chat, Home. No review button, no rating prompt.
- Probable cause from the wording: the rule "hidden until both are in or 7 days" suggests reviews open after both sides have submitted, or after 7 days, and the payment is still pending. I could not test the 5 and 4 stars or the text, nor review the extra separately.
- Rating: cannot rate (blocked).

### Step 31: Invoices and receipts, search, history
- Invoices and receipts: "You have no invoices or receipts yet. They appear here once a booking is settled." Still empty after all three confirmations. Nothing to open, so no VAT, commission, language, download or share to check.
- No search or filter on the invoice page. Nothing per booking.
- "Everything about J2 in one place": not possible. The J2 booking page has no link to its request, chat, quote, the extra or invoices. The chat (23e2c1cb-...) has no link back to the booking. The extra booking page does not link to the original J2. You can only find things by going through Bookings (three identical rows "Payment pending: it is being processed." dated Nov 6 10:56 AM) and Correspondence.
- Find J1's quote from the invoice: impossible (no invoice). Find the quote from the chat: the chat shows "Quote: €84.00 (version 1)" but it is not a link. The Quotes list shows "Quote TEST-Q-0988F5C3-2026-0001 ... Accepted" but not from the booking.

### Step 32: Log out
- Cleared localStorage, went to home. Account "Log out" not used.

## FLOW RATINGS (turn 7)
- FLOW RATING learning of finished work: 4/5 - banners clear; stale banner after confirming (2/5 for that part).
- FLOW RATING confirming the jobs: 4/5 - one tap plus a clear dialog; the payment-release wording is clear.
- FLOW RATING reviews: cannot rate - no entry point found.
- FLOW RATING invoices and receipts: 1/5 - empty, nothing to open, no search.
- FLOW RATING everything about one job in one place: 1/5 - no links between request, chat, quote, booking, extra and invoice.

### Step 33: "Payment pending: it is being processed." staying (turn 8, noted as asked)
- J1, J2 and the extra have shown "Payment pending: it is being processed." since my confirmations. Nothing else on the booking: no explanation of why, no expected time, no retry, no "contact support", no "your money is safe". The status buttons are gone (only "Open chat" and "Additional task" remain on the booking), so I cannot do anything either. What I would expect: a line such as "We are processing the payment. This usually takes X days. If nothing changes by [date], contact support" plus a support link, and a notice if it fails. I would worry that the money went nowhere.

### Step 34: New request J6: dog walk with AllMore T. (Bruno)
- Sign in: 3 taps. Provider page AllMore T. Services: "Portrait and event photos" EUR 120 (Book), "Van help for moves" EUR 35/hr (Request a quote), "Dog walks in Mitte" EUR 20 (Book). Tapped "Book" on "Dog walks in Mitte".
- The "Book" button opened the same form "Request a quote" (no price shown on the form). The service text says "One hour walk for dogs of all sizes, around Mauerpark and Rosenthaler Platz." The brief asked for 45 minutes: I set 45 and the description says 45 minutes. Mismatch between service text (one hour) and my request is not flagged.
- Form: Description (dog Bruno, leash, afraid of loud noises, lead and treat bag left at the door), Date 2026-11-08 (Sunday, within 3 days), Time 10:00, Duration 45, Street Torstrasse 100 (prefilled), Postcode 10115 (prefilled), City Berlin (prefilled), Note "message me in chat if running late". Send.
- Result: request c2bcca55-8585-42ac-a5dd-4f7b9a54d899, "Requested: Nov 8, 2026, 10:00 AM (45 min)", "On site: Torstrasse 100, 10115 Berlin", "Open", "Answer by Nov 9, 2026, 3:09 PM", "No quote yet.", buttons "Open chat", "Withdraw request". Send took about 8 s.
- Taps: 4 (provider page, Book, fill and Send, chat). Clear.

### Step 35: Chat with AllMore T. about Bruno
- "Open chat" -> new thread 21d52c37-bc9d-4ad0-a848-450fd103e07a ("No messages yet. Write the first one."). Different from the photo thread (23e2c1cb-...). Wrote: dog called Bruno, friendly medium-sized, on a lead the whole time, afraid of loud noises (fireworks, building work, traffic horns), quiet route around Mauerpark, lead and treat bag at the door, asked if they can make 10:00 on Sunday. Sent: appears at "Nov 6, 2026, 3:10 PM".
- Friction: no reply yet. Rating 4/5 for sending.

### Step 36: Finding the request and chat again later
- Bookings list shows the request as "Requests" item with the full text as the title; no name or date in the list; the text starts with "Dog walk for my dog Bruno..." so I can find it by first words. OK but weak.
- Messages list (/threads): four rows "AllMore T.", "AllMore T.", "All T.", "All T." (no date, no service, no request id). The new Bruno thread is one of the two "AllMore T." rows. I can only tell them apart by opening them. Rating 2/5.
- The request page links to its chat ("Open chat"), so the request is the best way back. Suggest a "Dog walk - AllMore T. - Sun 8 Nov 10:00" title on both.

## FLOW RATINGS (turn 8)
- FLOW RATING sending a new request (J6): 4/5 - few taps, clear.
- FLOW RATING chat about the dog: 4/5 - easy to write and send; no reply yet.
- FLOW RATING finding the request and chat again: 2/5 - identical titles.
- FLOW RATING "payment pending" wait: 1/5 - no explanation, no retry, no support.

### Step 37: J6 dog walk quote, pay, and status check (turn 9)
- Sign in: 3 taps. Home banners: "A quote is ready for your request. Confirm it to book; it is valid for 7 days." and "You have a new message." (plus older banners). Correspondence badge "2". Clear enough; the banner does not say which request.
- Request c2bcca55-8585-42ac-a5dd-4f7b9a54d899: "Quote sent". Quote EUR 20.00: "One dog walk, 45 minutes, on a lead, quiet route around Mauerpark. Pick-up at the front door, lead and treat bag provided by the customer." "Suggested time: Nov 8, 2026, 10:00 AM", "Open · Valid until Nov 8, 2026, 10:00 AM". Note: the quote expires at the walk time itself, same issue as J1.
- "Confirm quote": 1 tap, no confirmation dialog, straight to booking c8747afb-c36e-47df-83c4-5a5d6a945474: "Waiting for your payment, pay by Nov 7, 2026, 10:00 AM" (pay deadline the day before, which is reasonable).
- "Pay now": Stripe in a new tab ("Booking on 08/11/2026, 10:00", EUR 20.00). Card 4242 4242 4242 4242, 12/30, CVC 123, name Customer Tester. Same card-row workaround (script click to open the card section, then fill). Pay. Return page "Thank you ... being confirmed now". Closed the tab.
- Reloaded booking after about 12 s: "Paid and confirmed", "Time: Nov 8, 2026, 10:00 AM (45 min)", "Amount: €20.00", badge "Paid". Buttons "Open chat", "Additional task", "Cancel the booking".
- Waited 30 s, reloaded: still "Paid and confirmed" (same buttons, same amount).
- Rating: quote to paid 3/5 (no dialog, expiry on walk time, Stripe friction).

### Step 38: Log out
- Cleared localStorage, went to home.

## FLOW RATINGS (turn 9)
- FLOW RATING quote and pay the dog walk: 3/5 - banners clear; quote expiry on the walk time and Stripe card friction.
- FLOW RATING status after payment: 4/5 - "Paid and confirmed" shown quickly and stable after 30 s.

### Step 39: J6 dog walk marked finished: learn and confirm (turn 10)
- Sign in: 3 taps. Booking c8747afb-c36e-47df-83c4-5a5d6a945474 opened: heading "The provider marked the job finished. The payment to the provider is made on Nov 13, 2026, 3:18 PM unless you report a problem." Sub-line "7 days left to confirm or report a problem." How I learned: the booking page (I opened it directly; I did not check the Home banner this time).
- "Confirm the job was done" -> dialog "Confirm the job was done? The payment to the provider is then released." -> "Yes, it was done". 3 taps.
- Immediately after: heading "Completed". Only "Open chat" button.
- Reload after about 20 s: still "Completed" (time "Nov 6, 2026, 1:17 PM (45 min)", "Amount: €20.00"). The payout state is not shown on the booking, only "Completed". The "Payment pending" wording of the earlier bookings did not appear here.

### Step 40: Review (5 stars, short text)
- Reload showed a new block "Review": "How did it go? The other side sees your review once both are in, or 7 days after the job." Five radio stars (1 to 5 star), "A few words (optional)" text box, "Send review". Also "The other side's review: shows once both are in, or after 7 days."
- Where: on the booking page, under the receipt, once the booking is Completed. It was not announced by a banner or a button, I found it by scrolling down. Taps: 5 stars, text box, typed, Send review = 4 taps.
- Result: "Your review", "★★★★★", "Bruno was happy, quiet route, on time.", "The other side sees it from Nov 13, 2026, 3:19 PM, or as soon as their review is in.", "You can change it until Nov 13, 2026, 3:19 PM.", button "Change my review". Clear wording. Rating 5/5 for this step.
- Note: the stars are shown as ☆ before the click and ★ after; the radios are labelled "1 star" to "5 stars". Good.
- Review for the extra or J2: not reachable, the J2 and extra bookings are still "Payment pending" (no review block there).

### Step 41: Receipt (invoice) for J6
- Booking block: a button "Open Receipt TEST-3A792693-2026-0001 as PDF. Nov 6, 2026 · €20.00" with the title "Receipt TEST-3A792693-2026-0001" and "Nov 6, 2026 · €20.00". Clicking it downloads a PDF (no preview, and an empty tab opened for a moment).
- PDF content (read from the downloaded file): "Quittung (Receipt)", Number TEST-3A792693-2026-0001, issue date 06.11.2026. "Von (From): AllMore Tester, 10119 Berlin" (no street). "An (To): Customer Tester, Torstrasse 100, 10115 Berlin". "Leistung (Service): One dog walk, 45 minutes, on a lead, quiet route around Mauerpark. Pick-up at the front door, lead and treat bag provided by the customer., Leistungsdatum (Service date): 6.11.2026". "Arbeitskosten (Labour): 20,00 €, Material (Material): 0,00 €", "Betrag (Amount): 20,00 €", "Summe (Total): 20,00 €". "Ausgestellt im Namen und für Rechnung von AllMore Tester durch KANDO / Issued in the name and for the account of AllMore Tester by KANDO". Watermark "TESTDOKUMENT / TEST DOCUMENT".
- Missing: no VAT (MwSt/USt) line, no VAT number, no commission or platform fee line, no invoice number separate from the receipt number, no payment method, no booking or quote number, no provider street address. Bilingual German/English: good. Date format DD.MM.YYYY.
- The service date (6.11.2026) differs from the job date (8 Nov, test date move, ignore). The receipt is dated before the job happened.

### Step 42: Invoices and receipts list
- /invoices: one row "Receipt TEST-3A792693-2026-0001", "From AllMore Tester", "Nov 6, 2026 · €20.00". Only the J6 receipt. No J1, J2 or extra (payment pending). No search, no filter by date, provider, amount or service. No sort. Rows link straight to the PDF; no link to the booking or chat.

### Step 43: Quote document for J6
- /quotes: "Accepted quotes" row "AllMore Tester, Nov 6, 2026, Dog walks in Mitte, €20.00" (service name here, unlike the Photography quote). Under "My received quotes": "Open Quote TEST-Q-3A792693-2026-0003 as PDF. From AllMore Tester. Suggested time: Nov 8, 2026, 10:00 AM. Nov 6, 2026 · €20.00 · Accepted". Opened PDF (download).
- PDF "Angebot (Quote)", number TEST-Q-3A792693-2026-0003, issue 06.11.2026, From AllMore Tester 10119 Berlin, To Customer Tester, Service text, Place 10115 Berlin, "Termin: Sonntag, 8. November 2026 um 10:00", Duration 0 h 45 min, Total 20,00 €, "Gültig bis: 8.11.2026", "Dies ist ein Angebot, keine Rechnung (This is a quote, not an invoice)." No VAT, no commission.
- The quote PDF and the receipt have different numbers (…0003 vs …0001) and no link between them.

### Step 44: Referring back to J6 (from the invoice, from the chat, search)
- From the receipt: no link to the booking, the quote or the chat. You must go to Correspondence > Invoices, then to Bookings by hand (the bookings list has the request text as title, so you find the J6 booking by the words "Dog walk" or the date Nov 6 1:17 PM).
- From the chat (thread 21d52c37-bc9d-4ad0-a848-450fd103e07a): "Open chat" from the booking reaches it; the chat has no link to the receipt or quote.
- Search or filter by date, provider, amount or service: none on Invoices, Quotes, Bookings or Messages.
- Ideal in my words: one job page that shows the request text, the provider with a real address and photo, the chat in the same page, the quote and its PDF, the booking with its status and payment state, the receipt/invoice with the same job number, the review, and a timeline ("Requested 6 Nov, quote 6 Nov, paid 6 Nov, confirmed 6 Nov, receipt issued"). Plus search on the Invoices page by provider, date range, amount and job number, and a link from every PDF back to its job.

## FLOW RATINGS (turn 10)
- FLOW RATING confirming the job: 4/5 - clear dialog, "Completed" at once.
- FLOW RATING review: 4/5 - found below the receipt after completion, wording "The other side sees your review once both are in, or 7 days after the job." clear; no banner told me it was there.
- FLOW RATING receipt and quote documents: 3/5 - bilingual and clear, but no VAT/commission lines, no provider street, no link back.
- FLOW RATING finding everything about one job later: 1/5 - no links, no search, no timeline.

## Notification
- No push here. In the app, no toast or banner about the request was shown after sending. The request page says "Open" and "Answer by Nov 9, 2026, 1:22 PM". How I will know All has answered: not visible from this screen. Account has "Chat messages" and "Reminders" switched on; "You always get a notification about your bookings and payments."

