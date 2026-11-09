# Content truth audit: what the app, the website and the documents say, against the code

Date: 9 November 2026. Base: `origin/main` at `f0355ae` (after PR #107). Method: every claim below was traced to the code by reading it (constants, domain functions, routes, screens). Nothing was run; no database, no secrets, no dashboards were opened. The German catalogue was compared to the English one by script (see section 1.3), not read for language quality. Nothing was edited except this file.

Classes used in every table:

- **TRUE**: the code does what the text says (caveats are in the evidence column).
- **WRONG**: the code does something different, or the text says more or less than is true. A corrected wording follows.
- **NOT BUILT**: the text promises something that does not exist or is only a placeholder.
- **UNVERIFIABLE**: depends on something outside the repository (Vercel, Neon, Stripe, published page content, the lawyer). The last column says who must check what.

Line references are `file:line` in this checkout. `en.ts` is `packages/i18n/src/en.ts`, `en-server.ts` is `packages/i18n/src/en-server.ts`.

---

## 1. Summary

### 1.1 Counts

192 claims were classified (rows with an id in sections 2 and 3; a row with a mixed verdict is counted under its first class and says so in the row).

| Class | Count |
|---|---|
| TRUE | 120 |
| WRONG | 43 |
| NOT BUILT | 16 |
| UNVERIFIABLE | 12 |
| Not applicable (no store listing exists) | 1 |

By source (TRUE / WRONG / NOT BUILT / UNVERIFIABLE): numbers and rules 37 / 0 / 0 / 2; app texts 18 / 10 / 2 / 0; emails and notices 14 / 1 / 1 / 1; website 7 / 3 / 0 / 1; legal drafts 10 / 9 / 1 / 1; DPIA and Article 50 note 8 / 3 / 5 / 2; README 16 / 4 / 0 / 4; design papers 4 / 8 / 7 / 1; phone-test script 5 / 3 / 0 / 0; store and name 1 / 2 / 0 / 0.

The 12 UNVERIFIABLE rows plus the open items in section 5 (U-1 to U-10) are the things only the owner can check in a dashboard or in the published pages.

### 1.2 The ten most important problems (for a reviewer or a user)

1. **The legal pages are probably not public, yet the app and the website point at them.** The sign-up tick and the re-accept pop-up open `/agb` and `/datenschutz` (`apps/mobile/src/components/terms-checkbox.tsx:10`), the website footer links `/impressum`, `/datenschutz`, `/agb`, `/ranking` (`apps/web/components/footer.tsx:7-10`). README lines 130 and 158 say Impressum and Ranking return 404 and the terms and privacy pages are unpublished drafts. The AI disclosure the owner decided to put "in the terms accepted at sign-up" therefore may not be visible to anyone. The page text lives in the database, so only the owner can check production (rows U-1 to U-3).
2. **"Free for iPhone and Android" is not true** (`home.ctaText`, en.ts:311). There is no store listing, no iPhone build (README:99), and the website's own buttons say "soon". Same for any "coming soon" that sits next to a present-tense promise (rows A-2, C-1).
3. **"ID check coming soon" is stale.** A photo ID is required from every provider in every category (`packages/db/src/seed/categories.ts:8`) and since 3 November it is read by an AI aid and checked by staff. The home badge and the safety text still say the ID check is coming (rows A-1).
4. **Deleting and exporting do not do what the texts say.** The delete email says "all your data have been deleted" (en-server.ts:115) and the privacy draft says "immediately and for good"; in fact the money ledger, issued invoices, commission invoices and AI cost records stay (`packages/domain/src/account.ts:14,183`). The export button says "everything we hold about you" but leaves out invoices, the money ledger, disputes and commission invoices (`packages/domain/src/export.ts:144`). The text "we keep your documents 6 months" is also wrong for the photo ID, which is deleted at once (account.ts:127-157) (rows A-16 to A-19, D-8).
5. **Help and Feedback are two dead buttons on every screen except Home** (`apps/mobile/src/components/screen-banner.tsx`). A reviewer will tap them and see "Coming soon" (row A-12).
6. **The home and welcome texts describe a different flow.** "Get quotes from providers near you" and "See matching requests" suggest broadcast requests that providers browse. In the code a customer picks one provider and sends the request to that provider only (README:20; `MAX_OPEN_REQUESTS_PER_PAIR`, `packages/domain/src/bookings/rules.ts:20`). There is no feed of requests for providers (rows A-5, A-6).
7. **"Verified" means two different things.** The "Verified" badge on a provider page means the provider finished Stripe payout set-up and payments are switched on (`packages/domain/src/public-profile.ts:105`). The home page and how-it-works screen say "Verified providers: KANDO checks documents". The document check is shown separately as "Checked documents". Help must define both (row A-13).
8. **"Everything is stored on servers in Frankfurt, under GDPR" is too strong** (en.ts:275). Vercel runs in `fra1` (`apps/web/vercel.json:3`) and the docs say Neon is in Frankfurt (not checkable here), but Stripe, Resend, OpenRouter with its model provider and the Expo push service are processors with their own locations. The Expo push service (`packages/domain/src/push.ts:43`) is not listed in the privacy draft (rows A-3, D-13).
9. **The DPIA describes safeguards that are not built**: police certificate and the babysitting extended certificate "always staff", "first 50 approvals by a person", a per-document-type off switch, "reviewer must open the document before the buttons work", monthly approval and error reports, and "wrong approvals are withdrawn". The code has one uniform rule for every document type and the 10% spot check sends a document to staff before approval instead of auditing it afterwards (`packages/domain/src/ai/document-check.ts:138-143`, `rules.ts:40`). The legal text for the terms (5b, 4c) also says the date of birth "is used to check that providers meet the age requirement": nothing reads it (rows E-3 to E-9, D-11).
10. **The legal drafts in the repo are stale and use another product name.** `legal-pages-drafts.md` (28 October) says "Fees: none", "ratings do not exist yet", "our staff check them", "a sign-up checkbox is not built"; the app has a 15% commission, ratings, an AI-assisted check and the checkbox. The drafts call the product "SkillWeb"; the app, the emails and the website call it "KANDO" (`brand.name`, en.ts:4). README says production's `agb` page still shows 12% (README:117) (rows D-2 to D-8, N-1).

Also worth fixing before a reviewer reads the README: three README sentences are wrong (four tabs, "no terms tick yet", "one open request per customer and provider", rows F-1 to F-3), the phone-test script has three wrong expectations (rows H-2 to H-4), and two emails promise an effect that does not exist ("the app shows you as unavailable", row B-6).

### 1.3 What was compared, and how far it can be trusted

- English and German catalogues: 1008 app keys and 353 server keys on each side, no key missing on either side (script). Every number in each German text equals the number in the English text (the one hit, `review.waitTheirs`, is a quoting artefact of the script). So a number or rule that is TRUE below is TRUE in German too. The German was not read for wording. One style slip: `notification.quoteExpiring` uses capital "Du" where all other texts use "du".
- Code constants were read directly. Texts that quote no number were checked against the behaviour they describe.
- Production state (which pages are published, which environment variables are set, Stripe and Neon dashboards) was not looked at: see section 5.

---

## 2. Rules and numbers (every figure that a text states)

All of these are TRUE unless the class says otherwise. "T" in the text column means the number is in the English and German texts.

| Ref | Rule as users read it | Class | Evidence (code) | Note for Help |
|---|---|---|---|---|
| N-1 | Customer cancels more than 24 hours before the start: free, full refund (`booking.cancelFree`, en.ts:685; email, en-server.ts:79) | TRUE | `FREE_CANCEL_HOURS = 24`, `packages/contract/src/endings.ts:6`; `isLate` uses `>` so exactly 24 h is still free, `packages/contract/src/money.ts:26` | Cancelling is only possible for a paid (confirmed) booking before its start; unpaid ones are withdrawn |
| N-2 | Cancelling less than 24 hours before: 50 percent to the provider, rest back (en.ts:686,662) | TRUE | `LATE_CANCEL_SHARE = 0.5`, endings.ts:5; `lateCancelFee` money.ts:29-32; commission only on that share, `bookings/cancel.ts:78` | Percent in the text comes from the constant, not typed |
| N-3 | Provider cancels: customer gets everything back (en.ts:687,664) | TRUE | `cancelShare`, cancel.ts:39-45; payment fee is absorbed by the platform (comment cancel.ts:42-43) | |
| N-4 | Provider's late cancellation counts on the public profile for 12 months (en.ts:688,749) | TRUE | `provider_reliability`, `packages/db/src/rls.ts:421-427` (12 months, root bookings only) | Shown to customers as a count, not as a named fee |
| N-5 | No-show: the other side has 48 hours to object; without objection the report stands (en.ts:347,698) | TRUE | `NO_SHOW_OBJECTION_HOURS = 48`, endings.ts:8; `noShowObjectBy` ending-rules.ts:12; `resolveNoShow` cancel.ts:176-200 | Report possible only from the start time (`too-early`) |
| N-6 | Customer no-show: full price to provider minus commission; provider no-show: customer gets everything back (en.ts:667-668) | TRUE | `cancelShare` cancel.ts:39-45 | |
| N-7 | "Another no-show within 12 months can suspend your profile for 30 days" (en.ts:355; en-server.ts:91) | TRUE | First no-show: warning notice; from the second, staff get a flag, suspension is a manual staff action: `cancel.ts:181-182,249-251` | Say "can", never "will" |
| N-8 | Customer has 7 days after "Finished" to confirm or report a problem; payment released after 7 days of silence (en.ts:342,692) | TRUE | `CONFIRM_DAYS = 7`, `bookings/ending-rules.ts:7`; `finishJob` finish.ts:33 | Release waits if a problem is reported (dispute) or the provider cannot be paid out |
| N-9 | Reminders to the customer after 1, 3 and 6 days | TRUE | `CONFIRM_REMINDER_DAYS = [1,3,6]`, ending-rules.ts:8 | |
| N-10 | Provider can mark finished only from the start time | TRUE | `finishJob`, finish.ts:32 (`TOO_EARLY`) | |
| N-11 | "Was the job done?" 24 hours after the end if the provider did not tap Finished (en-server.ts:75) | TRUE | `ASK_DONE_HOURS = 24`, ending-rules.ts:9; timers.ts:216 | After 7 more days with no action it goes to staff as a "no response" dispute (`NO_ACTION_STAFF_DAYS = 7`, timers.ts:222-233) |
| N-12 | A reported problem: "our team decides within 14 working days; no money moves until then" (en.ts:714,717,729) | TRUE | `DISPUTE_DECISION_WORKING_DAYS = 14`, ending-rules.ts:4; `addWorkingDays` skips Saturday and Sunday only, public holidays are not counted (ending-rules.ts:46-57); settle refuses while disputed (disputes.ts:34) | It is a deadline for staff; an overdue flag exists (`dispute-overdue`). Never call it a guarantee |
| N-13 | Stop job: the provider states what was earned; the customer has 7 days; without an answer the team decides (en.ts:701) | TRUE | `STOP_ANSWER_DAYS = 7`, endings.ts:7; timers.ts:44 | |
| N-14 | Review: write within 7 days of completion; the other side sees it once both are in or after 7 days (en.ts:353,734) | TRUE | `reviewBy = completed + REVIEW_VISIBLE_DAYS`, finish.ts:109; `reviewVisibleAt` ending-rules.ts:66-67 | |
| N-15 | A review can be changed until it is shown or at most 14 days (en.ts:743-744) | TRUE | `REVIEW_EDIT_DAYS = 14`, `reviewFinalAt` ending-rules.ts:70-79 | Edit window ends earlier than 14 days if the other review arrives |
| N-16 | A quote is valid 7 days (en.ts:324,466) | TRUE | `QUOTE_VALID_DAYS = 7`, `bookings/rules.ts:9` | |
| N-17 | A request must be answered within 3 days (en.ts:323; en-server.ts:28) | TRUE | `REQUEST_ANSWER_DAYS = 3`, rules.ts:8 | |
| N-18 | Other side has 2 days to confirm a newly entered time; 7 days to agree a time at all | TRUE | `TIME_ANSWER_DAYS = 2`, `AWAITING_TIME_DAYS = 7`, rules.ts:23-25 | |
| N-19 | Pay deadline: 48 hours after acceptance, at least 24 hours before the start; 6 hours when the start is 24 hours or less away | TRUE | `payBy`, rules.ts:32-36 | Texts say "by the date shown", no number is typed |
| N-20 | "A booking with payment can be at most 60 days ahead" (en.ts:575) | TRUE | `MAX_PAY_AHEAD_DAYS = 60`, `payments/rules.ts:27`; enforced only while payments are on, `bookings/rules.ts:assertFuture` (otherwise the limit is 365 days) | |
| N-21 | Minimum payment EUR 0.50 (en.ts:577) | TRUE | `MIN_CHARGE_CENTS`, payments/rules.ts:33 | |
| N-22 | At most 5 open requests with one provider; at most 10 requests per day (en.ts:615,617) | TRUE | `MAX_OPEN_REQUESTS_PER_PAIR = 5`, `MAX_REQUESTS_PER_DAY = 10`, rules.ts:20-21 | README:28 says "one open request" (wrong, row F-3) |
| N-23 | Commission 15 percent, payment fees included (en.ts:977,981) | TRUE | `COMMISSION_RATE = 0.15`, `packages/contract/src/payments.ts:50`; the rate shown is read from the booking | Provisional (owner decision pending); the home texts correctly say "one percentage" without a number |
| N-24 | Chat: 2000 characters, 30 messages per 10 minutes, three blocked contact attempts in 24 hours flag the sender, phone updates every 4 seconds | TRUE | `MAX_MESSAGE_CHARS = 2000`, contract/chat.ts:9; `MESSAGE_LIMIT = 30` per 10 min, `CONTACT_ATTEMPTS_LIMIT = 3` per 24 h, `POLL_SECONDS = 4`, `chat/rules.ts:6-16` | Rules only: spelled-out numbers can still slip through (README:266) |
| N-25 | At most 12 portfolio photos, 2 past jobs, 20 skills of at most 50 characters | TRUE | `MAX_PORTFOLIO_PHOTOS = 12`, photos.ts:12; `MAX_PROVIDER_REFERENCES = 2`, providers/items.ts:12; skills `.max(20)` and `.max(50)`, `packages/contract/src/my-profile.ts:47` | There is no limit of 20 photos anywhere. The strengths are one text of up to 1000 characters; the "20 strengths of 50 characters" is a phone-side rule only (about-screen.tsx:84,142) |
| N-26 | Service radius 1 to 200 km, default 25 | TRUE | my-profile.ts:50; `packages/db/src/schema/providers.ts:40` | |
| N-27 | File limit "about 4.5 MB" (en.ts:207) | TRUE | `MAX_DOCUMENT_BYTES = 4_500_000`, documents.ts:14 (Vercel body limit). Photos: 10 MB in code, but also pass through Vercel | Documents above 4.5 MB cannot be uploaded (README:264) |
| N-28 | Search: 20 per page, nearest first, then by name; ratings do not change the order | TRUE | `PAGE_SIZE = 20`, search.ts:8; `ORDER BY d.km NULLS LAST, lower(p.public_name)`, search.ts:79 | |
| N-29 | Busy times are shown for the next 30 days (en.ts:480) | TRUE | `DAYS = 30`, `apps/mobile/src/screens/bookings/busy-times.tsx:11` (the server allows 62, contract/bookings.ts:280) | Times only, no calendar |
| N-30 | Photo ID image is deleted 30 days after the AI check; at once with the account | TRUE | `ID_IMAGE_KEEP_DAYS = 30`, ai/document-check.ts:16,185; account.ts:127-157 | Runs in the daily job `/api/cron/suspensions`; README:128 says the crons may be paused: UNVERIFIABLE whether it runs (row U-8) |
| N-31 | AI check: no automatic approval unless no problem and confidence at least 0.8; 10% random spot check goes to a person; AI never rejects; 10 checks per person and hour; monthly cost cap EUR 20 | TRUE | `ai/rules.ts:4-5,40`, `document-check.ts:18,20,138-162` | Live only when `OPENROUTER_API_KEY` and `AI_DOCUMENT_MODEL` are set (UNVERIFIABLE on production) |
| N-32 | ID card scan: 10 scans per person and hour, only with accepted terms, photo not stored | TRUE | `SCANS_PER_HOUR = 10`, `ai/id-scan.ts:11,91-107` | |
| N-33 | Retention: notices 180 days (seen or dismissed), Stripe events 90 days, push tokens 270 days, blocked contact text 90 days, trader records 6 months | TRUE | `packages/domain/src/retention.ts:5-7`; `chat/rules.ts:9`; `retentionMonths()` account.ts:41-48 | The text "6 months" is typed in `account.deleteRetention` (en.ts:453) while the length is an environment variable: they can drift apart (docs/deployment.md:88) |
| N-34 | Translate: 30 per person and hour, 2000 per day in total | TRUE | `TRANSLATE_LIMIT_PER_HOUR = 30`, `TRANSLATE_GLOBAL_LIMIT_PER_DAY = 2000`, translate.ts:16-18 | README:20 says "per person and per day" (row F-5) |
| N-35 | Invoice export: years 2020 to next year (en.ts:867) | TRUE | `invoices/export.ts:19` | |
| N-36 | Past-job year from 1970 | TRUE | my-profile.ts:106 | |
| N-37 | Notices: 40 kinds | TRUE | `NOTIFICATION_KINDS`, contract/me.ts:27 (counted) | |
| N-38 | Session lasts 7 days; login locked for 10 minutes after too many failed attempts (en.ts:38); 6-digit code (en.ts:370) | UNVERIFIABLE | Set in Neon Auth, not in this repository. Only docs state them: `docs/rls-and-auth-evidence.md:6`, plan 2026-10-26:252 | Owner: Neon console, Auth settings. Until checked, do not put "7 days" or "10 minutes" in Help as fact |
| N-39 | Payout "within 7 days of confirmation" (en.ts:278; en-server.ts:72) | UNVERIFIABLE | The platform releases the transfer at confirmation (finish.ts:88-99) and sets daily automatic payouts for each connected account (`stripe-gateway.ts:73`). When the bank receives it depends on Stripe, including Stripe's initial payout delay for new accounts | Owner: confirm with Stripe test and live behaviour before promising "7 days" |

---

## 3. Tables per source

### 3.1 App texts, English catalogue (`packages/i18n/src/en.ts`; German in `de.ts` with the same line numbers within a few lines)

| Ref | Key and line | Claim | Class | Evidence | Corrected wording (EN / DE) |
|---|---|---|---|---|---|
| A-1 | `home.badgeVerifiedText` en.ts:252; `home.safetyVerifiedText` en.ts:267-268 (de.ts:251) | "Documents checked / ID check coming soon" | WRONG | Photo ID is required in every category: `categories.ts:8,13-26` (`BASE = ['id-document']`). It is read by an AI aid and checked by staff: `ai/document-check.ts:138-162`, README:60 | EN: "Documents checked / Photo ID and documents are checked". DE: "Dokumente geprüft / Ausweis und Nachweise werden geprüft". Safety text EN: "KANDO checks documents and photo ID; babysitters must hold an extended police certificate." DE: "KANDO prüft Nachweise und Ausweis; für Babysitting ist ein erweitertes Führungszeugnis Pflicht." |
| A-2 | `home.ctaText` en.ts:311 (de.ts:310) | "Free for iPhone and Android." | NOT BUILT | No store listing; no iPhone build (README:99,158); website buttons say "soon" (`apps/web/app/(site)/[lang]/page.tsx:20-35`) | EN: "Coming soon for iPhone and Android." DE: "Bald für iPhone und Android." |
| A-3 | `home.safetyEuText` en.ts:275 (de.ts:274) | "Everything is stored on servers in Frankfurt, under GDPR." | WRONG | Vercel region `fra1`: `apps/web/vercel.json:3`; Neon "AWS Frankfurt" only in `docs/deployment.md:9` (UNVERIFIABLE here). Stripe, Resend, OpenRouter and its model provider, Expo push are separate processors (privacy draft lists them; locations unconfirmed) | EN: "Your account data is stored on servers in Frankfurt, Germany. Our partners process data under GDPR." DE: "Deine Kontodaten liegen auf Servern in Frankfurt. Unsere Partner verarbeiten Daten nach DSGVO." |
| A-4 | `home.payment` / `home.paymentText` en.ts:366-369, `howto.paymentText` en.ts:271 | "Your money is held by a licensed payment provider and is paid out when you confirm - after 7 days at the latest." | TRUE | Release at confirmation or 7 days: finish.ts:33,88-99; Stripe Connect separate charges and transfers (`payments/rules.ts:11-17`). Caveat: not "at the latest" if a problem is reported or the provider's payout account is missing (`job.state.payout_account_missing`, en.ts:911-914). The word "held" is a legal question (row U-9) | Keep, but add "unless a problem is reported". EN: "...paid out when you confirm, or after 7 days if nobody reports a problem." DE: "...ausgezahlt, wenn du bestätigst, oder nach 7 Tagen, wenn kein Problem gemeldet wird." |
| A-5 | `home.customer2` en.ts:258; `welcome.needHelpText` en.ts:314 | "Get quotes from providers near you." | WRONG (misleading) | A request goes to one chosen provider: README:20; `MAX_OPEN_REQUESTS_PER_PAIR` rules.ts:20; the customer finds providers by search and requests a quote on the provider page. No broadcast to several providers | EN step 2: "Pick a provider and ask for a quote." DE: "Wähle einen Anbieter und frage ein Angebot an." welcome: EN "Describe what you need for free and ask a provider near you for a quote." DE "Beschreibe kostenlos, was du brauchst, und frage einen Anbieter in deiner Nähe nach einem Angebot." |
| A-6 | `home.provider2` en.ts:262 | "See matching requests and send your quote." | WRONG | Providers receive requests addressed to them; there is no list of matching open requests (`app-api/v1/requests` lists the caller's own requests only) | EN: "Receive requests from customers and send your quote." DE: "Erhalte Anfragen von Kunden und sende dein Angebot." |
| A-7 | `home.providersText` en.ts:277-278 | "No lead fees, no subscription, no bidding for jobs. You only pay when you earn: one percentage of the paid job, paid out within 7 days of confirmation." | TRUE (payout timing: UNVERIFIABLE) | No fee code other than commission at release (`payments/settle`, `COMMISSION_RATE`); no bidding (row A-5). Payout timing: row N-39 | Keep; soften "within 7 days" until N-39 is confirmed |
| A-8 | `home.badgeNoFees` en.ts:253-254 | "No lead fees for providers" | TRUE | See A-7 | |
| A-9 | `home.safetyReviewsText` en.ts:270 | "Only after paid jobs - no bought stars." | TRUE | A review needs a completed booking, once: `WriteReviewSchema`, endings.ts:61-62; completed means paid and released | |
| A-10 | `home.paymentBadgeText`, `home.metaDescription`, `home.soon` en.ts:252-309,367 | "In-app payment coming soon" | TRUE | Real money is blocked: `LIVE_PAYMENTS_ALLOWED = false`, payments/rules.ts:7. The app does take Stripe TEST payments (README:3). The how-it-works texts (en.ts:259,263) are in present tense | For a reviewer: say "payments run in test mode" in the Help and in the presentation |
| A-11 | `home.howTitle` en.ts:255 | "How it will work - three steps" | TRUE | The steps exist (test mode); "will" is only about live money | |
| A-12 | `banner.help`, `banner.feedback`, `banner.soon` en.ts:966-968 | Two buttons "Help" and "Feedback" that answer "Coming soon." | NOT BUILT | `apps/mobile/src/components/screen-banner.tsx:12-31` (placeholders, said so in the code comment); on every screen except Home; plan `docs/superpowers/plans/2026-11-09-feedback-and-help.md` | Hide both buttons until PR 6 and 7a ship, or keep and tell the reviewer. Honest interim text EN: "Help is being written. Write to {contact}." DE: "Die Hilfe wird gerade geschrieben. Schreibe an {contact}." |
| A-13 | `provider.verified` en.ts:75; `home.safetyVerified` en.ts:266; `howto.verifiedText` en.ts:272; `email.payoutSetupComplete.body` en-server.ts:57 | "Verified" badge / "Verified providers: KANDO checks documents" | WRONG (conflated) | Badge: `verified: paymentsEnabled() && payouts_ready_at !== null`, public-profile.ts:105; shown at `provider-screen.tsx:87`. Document checking is a different feature ("Checked documents", en.ts:71). Badge is not shown at all while payments are off | Decide one meaning. Suggested EN badge help: "Verified: this provider's identity and bank account were checked by our payment partner Stripe." DE: "Verifiziert: Identität und Bankkonto wurden von unserem Zahlungspartner Stripe geprüft." Rename `home.safetyVerified` to "Checked providers" / "Geprüfte Anbieter" |
| A-14 | `setup.documentsExtra` en.ts:157 | "Your documents will be vetted for authenticity, but will never be shown to anyone. Potential customers will see a list of the documents you submitted." | WRONG | Staff open the documents; an AI service reads them (`document-check.ts`, OpenRouter, sent once); the DPIA itself says the AI is not a forgery detector (DPIA risk 7). Customers see only names: `public_checked_documents` (rls.ts:393) | EN: "Our team checks your documents, with the help of an automated check. Customers only see which documents you submitted, never the documents themselves." DE: "Unser Team prüft deine Dokumente, unterstützt durch eine automatische Prüfung. Kunden sehen nur, welche Dokumente du eingereicht hast, nie die Dokumente selbst." |
| A-15 | `idScan.note` en.ts:402 | "An AI service reads the photo once ... The photo is not saved." | TRUE | `scanIdCard`, ai/id-scan.ts:91-107 (held in memory; `data_collection: deny`, `zdr: true`, openrouter.ts:89) | The provider's no-retention promise is UNVERIFIABLE (owner confirms with the provider) |
| A-16 | `account.exportHint` en.ts:433 | "Get everything we hold about you as one document" | WRONG | `export.ts:144` lists user, provider, services, references, requests, quotes, bookings, quote documents, own messages, own reviews, blocks, watches, photos, documents, AI checks, private files, notices. Missing: invoices and receipts, commission invoices, ledger of money movements, disputes, staff flags about the person, contact-attempt texts, push tokens | EN: "Get your account details, profile, files, requests, quotes, bookings and your messages as one document." DE: "Erhalte deine Kontodaten, dein Profil, deine Dateien, Anfragen, Angebote, Buchungen und deine Nachrichten als ein Dokument." (and add invoices to the export, or say "ask us for invoices") |
| A-17 | `account.deleteWarning` en.ts:436 | "This deletes your account, your profile with its services and references, your photos, your uploaded files and your messages. It happens at once and cannot be undone." | WRONG (incomplete) | `deleteAccount`, account.ts:100-203. Also deleted: your requests, quotes, bookings, reviews, disputes and the whole chat threads (the other person loses the chat too). Kept: money ledger, invoices, commission invoices, AI cost record; trader record 6 months. Refused while money is open (`account.openBookings`, en.ts:868: TRUE) | EN add: "Your jobs and chats are deleted for the other side too. Invoices and payment records we must keep by law are kept." DE: "Deine Aufträge und Chats werden auch für die andere Seite gelöscht. Rechnungen und Zahlungsbelege, die wir gesetzlich aufbewahren müssen, bleiben erhalten." (retention period: open question Q-5) |
| A-18 | `account.deleteRetention` en.ts:453; `email.accountDeleted.retained.body` en-server.ts:278 | "...we must keep these documents and your basic trader details for 6 months because of a legal duty." | WRONG (partly) | The photo ID is NOT in the retained record and its image is deleted at once: account.ts:127-132 (`idNow` filtered out of `docRows`), 197. Other documents and basic details are kept (account.ts:140-157). "Because of a legal duty" is itself the open lawyer question (README:253) | EN: "...we keep your other verification documents (not your photo ID) and your basic trader details for 6 months..." DE: "...bewahren wir deine übrigen Nachweise (nicht deinen Ausweis) und deine Grunddaten als Anbieter 6 Monate auf..." |
| A-19 | `email.accountDeleted.body` en-server.ts:115 | "Your account and all your data have been deleted ... This cannot be undone." | WRONG | See A-17: ledger, invoices, commission invoices and AI cost records remain | EN: "Your account and your personal data have been deleted, except records we must keep by law, such as invoices and payment records." DE: "Dein Konto und deine personenbezogenen Daten wurden gelöscht, außer Unterlagen, die wir gesetzlich aufbewahren müssen, zum Beispiel Rechnungen und Zahlungsbelege." |
| A-20 | `terms.reaccept.body` en.ts:414 | "Until you accept, you can look around but not change anything." | TRUE | Every write answers 428 except accepting and deleting the account: `app-request.ts:22,118-120` | |
| A-21 | `account.pushHint` en.ts:426 | "You always get a notification about your bookings and payments." | TRUE (with a condition) | Only chat and reminder kinds have switches (`push.ts:42-43`); the rest always goes out. With no phone token it goes by email instead. Push to Android needs the FCM credentials, which the README lists as an owner action (README:207): UNVERIFIABLE whether push reaches phones today | Help: "by push if allowed, otherwise by email" |
| A-22 | `provider.reliability.*` en.ts:749-750 | "Cancelled late or did not turn up N times in the last 12 months" | TRUE | rls.ts:421-427 | |
| A-23 | `chat.contactBlocked` en.ts:622 | "...payment protection, reviews and our help with disputes only apply to what happens in the app." | TRUE | Disputes and reviews exist only for bookings created in the app; "payment protection" is wording to keep short of "Treuhand/Garantie" (README:247 asks the lawyer) | |
| A-24 | `search.*`, `error.invalidPostcode`, `search.postcodeInvalid` en.ts:29,52 | "5 digits" (search), German postcodes | TRUE | Country comes from the saved address; only Germany exists (`packages/db` countries) | |
| A-25 | `booking.payPromptNote` en.ts:583 | "the job will be considered confirmed after you submit your payment" | TRUE | The booking becomes confirmed only through the payment webhook (README:59; `rules.ts` comment TRANSITIONS) | |
| A-26 | `setup.liveLocked` en.ts:131; `error.profileIncomplete` en.ts:32 | "Fill in the fields marked * to go live" | TRUE | Required: name, one service, provider type, business name and legal notice (business), at least one strength, one skill, postcode, radius: `Missing` enum, my-profile.ts:8; `profile.ts:51`. The picture and the experience text are optional | |
| A-27 | `job.state.*.body` en.ts:884,892 | "The money is held safely until the job is done." | TRUE (legal wording open) | Same as A-4. Foundation design bans "Treuhand", "Escrow", "Garantie" (design 2.3); "held safely" is not banned but is the wording the lawyer was asked about (README:248) | Keep until the lawyer answers Q-1 |
| A-28 | `payments.off` en.ts:578 | "Payments are not switched on yet." | TRUE | `paymentsEnabled()` reads `PAYMENTS_ENABLED`, payments/rules.ts:54. Production value: UNVERIFIABLE (README:149 says on, test mode) | |
| A-29 | `auth.termsSentence` en.ts:387 | "I am at least 18 years old and accept the terms" | TRUE (only a tick) | Tick checked in the app (`sign-up-screen.tsx:49`); no age is verified anywhere. The date of birth is stored but never compared (users.ts:105,139; export.ts:46) | |
| A-30 | `money.strip.*` en.ts:962-972 | "Received this month / On its way / On hold", "after commission and fees" | TRUE with a gap | The three explanations are built; the line saying what the strip does not count (unpaid jobs, stopped jobs until released, refunded bookings) is still to be written, README:123 | Add the missing line before Help describes the strip |

### 3.2 Server texts: emails and notices (`packages/i18n/src/en-server.ts`, `en.ts` notice texts)

| Ref | Key and line | Claim | Class | Evidence | Corrected wording (EN / DE) |
|---|---|---|---|---|---|
| B-1 | `email.requestReceived.body` en-server.ts:28 | "Please answer within 3 days ... Requests that stay unanswered expire" | TRUE | N-17 | |
| B-2 | `email.quoteReceived.body` en-server.ts:31 | Valid for 7 days; if no date, agree after accepting; payment asked once both confirmed | TRUE | N-16, N-18 | |
| B-3 | `email.bookingAccepted.body` en-server.ts:34 | "you will see the pay link there as soon as payment is available" | TRUE | When payments are off the app shows `payments.off`; pay card knows (README:29) | |
| B-4 | `email.jobFinished.body`, `email.confirmReminder.body` en-server.ts:65,68 | Payment released from {date}; confirm or report a problem before | TRUE | N-8, N-9 | |
| B-5 | `email.bookingCancelled.*` en-server.ts:79-87 | Free more than 24 h; late: {percent}% minus commission; provider cancel: full refund; no-show cases | TRUE | N-1 to N-6 | |
| B-6 | `email.requestsIgnored.body` en-server.ts:47; `email.requestReceived.body` en-server.ts:28 | "the app shows you as unavailable"; "customers leave, trust and visibility suffer"; "make you look unavailable" | NOT BUILT | Nothing marks a provider unavailable or lowers visibility after ignored requests: search ordering is distance then name (search.ts:79) and the public profile has no such flag (public-profile.ts). What exists: the customer is told "provider is not available" for that request (`email.requestExpired`, en-server.ts:45); after 3 expired requests in 30 days a notice (`IGNORED_LIMIT`, rules.ts:11-12) and 14 days later a staff flag (`IGNORED_FLAG_DAYS`, rules.ts:14; timers.ts:255) | EN: "This hurts your business: customers leave and trust suffers, and our team may contact you. Please write to {contact} to confirm that you still want to be on the platform, or to withdraw your services." DE: "Das schadet deinem Geschäft: Kunden wenden sich ab und das Vertrauen leidet, und unser Team meldet sich möglicherweise bei dir. Bitte schreibe an {contact}, ob du weiter auf der Plattform bleiben möchtest, oder nimm deine Leistungen zurück." |
| B-7 | `email.providerWarning.body` en-server.ts:91 | "...as you did not object to the report within 48 hours. Another one within 12 months can suspend your profile for 30 days." | TRUE | N-5, N-7 | |
| B-8 | `email.disputeOpened.body`, `dispute.decideBy` en-server.ts:97; en.ts:729 | "Nothing is paid out until our team has decided" | TRUE | N-12 | |
| B-9 | `email.paymentReleased.provider.body` en-server.ts:72 | "usually within 7 days" | UNVERIFIABLE | N-39 | |
| B-10 | `email.paymentReceived.body` en-server.ts:50 | "The money is paid to the provider only when the work is done." | TRUE | N-8 | |
| B-11 | `email.customersWaiting.body` en-server.ts:60 | "We tell them as soon as you are ready. To protect their privacy we do not say who they are." | TRUE | `payments/watches.ts` (watch notice, count only); at most one notice per 24 h per provider: `CUSTOMERS_WAITING_NOTICE_HOURS`, payments/rules.ts:10 | |
| B-12 | `email.reviewRequested.body` en-server.ts:77 | Write a review by {date} | TRUE | N-14 | |
| B-13 | `email.jobStopped.body` en-server.ts:103 | "Nothing is paid out for the work not yet done." | TRUE | Stop flow: stop.ts / N-13 | |
| B-14 | `notification.reviewRequested` en.ts:353, `notification.noShowReported` en.ts:347 | 7 days; 48 hours | TRUE | N-14, N-5 | |
| B-15 | `email.messageReceived.body` en-server.ts:107 | Email only when push would not reach (30 min throttle) | TRUE | `pushReaches`, push.ts:56-57; `CHAT_EMAIL_THROTTLE_MINUTES = 30`, chat/rules.ts:14 | |
| B-16 | `email.documentRejected.body` en-server.ts:17 | "Please upload a corrected document in the app (My profile, then Verification documents)" | WRONG (name) | The tab is called "My business" (`tab.myProfile`, en.ts:82) and the cards in My business hold the documents (`apps/mobile/src/app/(tabs)/_layout.tsx:78`) | EN: "(My business, then Verification documents)". DE: "(Mein Geschäft, dann Verifizierungsdokumente)" (German tab name checked, de.ts:81) |
| B-17 | Notices 40 kinds, each with push, email and in-app text | TRUE | `notification-parity.int.spec.ts` (enforced), 40 kinds counted | |

### 3.3 Public website (`apps/web/app/(site)`)

| Ref | File and key | Claim | Class | Evidence | Corrected wording (EN / DE) |
|---|---|---|---|---|---|
| C-1 | `[lang]/page.tsx:20-35` | Buttons "App Store · Coming soon" and "Google Play · Coming soon" (not links) | TRUE | Plain `<span>`s, no href; the comment says the links do not exist until the app is published | |
| C-2 | `home.headline`, `home.intro` en.ts:247,250 | "Finally, someone who can" / "Find helpers near you - or new customers for your skills." | TRUE | Search is in the app only; the website has no search or sign-in (README:133) | A reviewer opening the site cannot reach the app: see open question Q-9 |
| C-3 | three badges `home.badgeVerified`, `home.payment`, `home.badgeNoFees` | "Documents checked / ID check coming soon"; "Paid when it's done / In-app payment coming soon"; "No lead fees for providers" | WRONG (first), TRUE (second, third) | A-1; A-10; A-8 | See A-1 |
| C-4 | three-step how-it-works `home.customer1..3`, `home.provider1..3` en.ts:257-263 | Customer: describe, get quotes from providers, pay in the app. Provider: profile, matching requests, get paid in the app | WRONG (customer2, provider2), TRUE otherwise | A-5, A-6. Customer3: payments only in Stripe test mode (A-10). "no lead fees, no subscription" TRUE (A-7) | See A-5, A-6 |
| C-5 | `home.safetyTitle` block en.ts:264-275 | Verified providers; genuine reviews; data in the EU; paid when it's done | WRONG (verified, EU), TRUE (reviews, payment) | A-13, A-3, A-9, A-4 | |
| C-6 | category tags (`home.categoriesTitle`) | 15 category names | TRUE | Tags, not links (README:133); list comes from the database (`listCategories`); 14 launch categories in the seed plus "other services"; production holds 15 (README:98) | |
| C-7 | Footer `components/footer.tsx:7-10` | Links Legal notice, Privacy, Terms, Ranking | UNVERIFIABLE | The pages are records in the back office (`[slug]/page.tsx`). README:130 says Impressum and Ranking are 404; terms and privacy unpublished | Owner: open `/impressum`, `/datenschutz`, `/agb`, `/ranking` on skillweb.space in both languages (Q-6) |
| C-8 | `web.paymentDone.*`, `payout-done` pages en.ts:294-304 | "If you completed the payment, it is being confirmed now ..." | TRUE | Booking confirms by webhook; page makes no promise | |
| C-9 | `provider.translatedLabel`, `web.translatedLabel` en.ts:73,284 | "Automatically translated (AI) · Show original" | TRUE | Label shown with translated text; original kept (`translate.ts`, Article 50 note) | |
| C-10 | `web.getAppText` en.ts:281 | "Enquiries and bookings happen only in the KANDO app." | TRUE | No booking route on the website | But the app is not downloadable yet (A-2) |
| C-11 | `web.footer.credit` en.ts:291 | "Postcode data (c) GeoNames (CC BY 4.0)" | TRUE | GeoNames licence is CC BY 4.0 | |

### 3.4 Legal drafts (`docs/legal-drafts/`)

The terms and privacy pages are database records; the markdown files are the drafts that were pasted in. Whether the records match these files, and whether they are published, cannot be seen from the repository (rows U-1 to U-3).

| Ref | File and section | Claim | Class | Evidence | Corrected wording (EN / DE) |
|---|---|---|---|---|---|
| D-1 | `legal-pages-drafts.md` 1 (Impressum) | Amplivine, legal form, address, VAT none, person responsible Liezl Fourie, info@skillweb.space, dispute resolution "not willing" | UNVERIFIABLE | Placeholders in brackets; address Wustermark added in `section-8a-payment-draft.md:5`. `PLATFORM_ENTITY` is still `[LEGAL NAME]` etc. (`invoices/entity.ts:2-8`) | Owner and tax adviser: legal form, address, register, VAT rule (Q-4) |
| D-2 | `legal-pages-drafts.md` 2 (Ranking) | "Ratings and reviews ... do not exist yet; when we add them, this page will be updated before they affect the order." | WRONG | Reviews exist and ratings show on search cards (`ratingsOf`, search.ts:6). They do not affect the order (search.ts:79) | EN: "Ratings and reviews are shown with each provider but do not change the order." DE: "Bewertungen werden bei jedem Anbieter angezeigt, ändern aber die Reihenfolge nicht." |
| D-3 | Ranking: order is distance, then name; remote providers after nearby ones; on-site providers only inside their radius; nobody can pay for placement | TRUE | search.ts:79; README:19 | |
| D-4 | Ranking: "documents ... checked by SkillWeb staff" | WRONG | A document can be approved by the AI aid when no problem is found and confidence is at least 0.8; 10% go to a person anyway (`document-check.ts:138-162`) | EN: "...the documents required for its services have been checked by SkillWeb staff or, where it found no problem, by an automated check that staff sample." DE entsprechend |
| D-5 | Terms 4: "Fees: [none at present / to be decided when payments are added]" | WRONG | A 15% commission exists (`COMMISSION_RATE`); section 8a covers it (`section-8a-payment-draft.md:14`). README:117: production `agb` still says 12% | Replace by "Fees: see section 8a" / "Gebühren: siehe Abschnitt 8a" |
| D-6 | Terms 5: "Our staff check them." | WRONG | See D-4; section 5a (AI) is drafted in `ai-document-check-legal-text.md` | Merge 5 and 5a so the sentence names the automated check |
| D-7 | Terms 2, 4, 10: 18 years; "A profile picture is optional"; "text you enter in your legal notice and the client names you list ... are public"; "you may be asked to accept new terms" | TRUE | `terms-reaccept.tsx`, `app-request.ts:118-120`; photo optional (`Missing` enum); public texts `public-profile.ts` | Open: 16-year-olds (README:254-258) |
| D-8 | Terms 6 and Privacy 6: "You can delete your account ... Your data is then deleted, except the verification documents and trader details, kept 6 months"; "Deleting your account in the app removes your data immediately and for good: profile, photos, services, references, notifications and login" | WRONG | A-17, A-18: ledger, invoices, commission invoices and AI cost record stay; the photo ID is deleted at once; bookings, requests, chats and reviews are also deleted | Add: "We keep invoices and payment records as long as accounting and tax law requires [period]" / "Rechnungen und Zahlungsbelege bewahren wir so lange auf, wie Buchführung und Steuerrecht es verlangen [Dauer]" |
| D-9 | `section-8a-payment-draft.md` 8a.1 Paying | Pay on Stripe's page; full amount; confirmed when Stripe confirms; unpaid lapses; "more than 60 days ahead cannot be paid yet"; no card data stored | TRUE | Checkout is Stripe-hosted (`stripe-gateway.ts`); N-20 (only while payments are on) | |
| D-10 | 8a.2 to 8a.11 | Release after 7 days or on confirmation; reminders 1, 3, 6; commission 15% deducted from the payout, no customer fee, monthly commission invoice; invoice or receipt in the provider's name; cancel rules; provider cancel; no-show 48 h; stop: other side has 7 days; additional task is a separate booking with its own payment; staff decide within 14 working days with written reason; reviews 1 to 5 hidden until both or 7 days | TRUE | N-1 to N-15, N-23. Invoices: `invoices/issue.ts:36-57` (issued after settlement); commission invoices monthly (`commission.ts`, cron 05:00 UTC, `apps/web/vercel.json`) | Two gaps for the lawyer: 8a.8 does not say that without agreement the team decides (en.ts:701); 8a.2 "verified by Stripe" is TRUE |
| D-11 | `payments-and-id-scan-legal-text.md` 5b and 4c | "The date of birth ... is used to check that providers meet the age requirement." | NOT BUILT | Stored (`users.birthDate`, users.ts:105,139) and exported (export.ts:46), never compared to anything; the only age gate is the tick (A-29). Providers from 16 is an open decision (README:254) | EN: "The date of birth is private and never shown to other users." DE: "Das Geburtsdatum ist privat und wird anderen Nutzern nie angezeigt." Or build the age check (Q-7) |
| D-12 | 5b/4c: photo sent once with no training and no retention; card number not read; nothing saved before Save; only with accepted terms; under Account | TRUE | A-15; `account-screen.tsx:149`; prompt asks only for name, birth date, street, postcode, city (`ai/id-scan.ts:21-24`) | Provider-side guarantees: UNVERIFIABLE |
| D-13 | `legal-pages-drafts.md` Privacy 2 and 3 | Processors: Neon (Frankfurt), Vercel (Frankfurt), Resend, OpenRouter, Stripe (added later); "We do not use advertising, tracking or analytics cookies" | WRONG (missing processor) | Push texts go through Expo's push service: `EXPO_URL = 'https://exp.host/...'`, push.ts:43; device tokens stored (retention 270 days). No analytics package found in `apps/` or `packages/` (searched gtag, plausible, posthog, vercel analytics, sentry: none) so the cookie sentence is TRUE | Add Expo (and Google FCM for Android push) as processors with location and agreement status [confirm] |
| D-14 | Privacy 2: "Address ... Street and city are never shown to others." | WRONG | The provider sees the customer's street and city once the customer confirms the quote and the booking exists (before payment): `bookings/requests.ts:172`, `confirm.ts:85`; before that it is hidden (`hideStreet`, requests.ts:269) | EN: "Your street and city are shown to a provider only after you have accepted that provider's quote, and only for on-site jobs." DE: "Straße und Ort sehen nur Anbieter, deren Angebot du angenommen hast, und nur bei Einsätzen vor Ort." |
| D-15 | Privacy 4 (Translation) | Provider texts only (bio, strengths, experience, skills, service titles and descriptions, reference descriptions); names, emails, addresses, documents never sent; translations stored and reused; salted IP hash kept 24 hours | TRUE | `translate.ts:39-47,98-104,152`; the cache has no user link | Open: OpenRouter terms (no training) and data location |
| D-16 | Privacy 6 retention | Account until deletion; documents while the account exists; hashed IP 24 hours; logs at Vercel [period]; emails at Resend [period] | TRUE for what is stated; incomplete | Missing from the text: notices 180 days, Stripe events 90 days, push tokens 270 days, blocked contact text 90 days, chat messages (kept until the account is deleted, no period in code), payment records and invoices [period], ID image 30 days (in 4a) | Add the periods from N-33; decide a chat retention (Q-5) |
| D-17 | Privacy 7 | "Export my data (JSON or CSV)" and "Delete my account" in the app; answer within one month | TRUE for the buttons (`export.ts`, account.ts); the export is incomplete (A-16) | | |
| D-18 | Privacy 8 | "Published pictures ... are reachable by their web address"; "staff accounts are limited by role and their changes are logged"; HTTPS; breach within 72 hours | TRUE (pictures, roles), WRONG (logged) | Roles: administrator and reviewer (README:42). Logging exists only for named actions as log lines: chat opening (`admin.thread.logged`), dispute re-decision and review moderation (`admin/bookings.ts:101,225`), `reviewedBy` on documents; no audit table | EN: "Our staff accounts are limited by role; opening a chat and money decisions are logged." DE: "Unsere Mitarbeiterkonten sind nach Rolle beschränkt; das Öffnen von Chats und Geldentscheidungen werden protokolliert." |
| D-19 | `ai-document-check-legal-text.md` 5a and 4a: sent once, no training and no retention; "processed in the EU where available [confirm]"; AI does not decide alone; never rejects; a person samples about one in ten; only verdict, confidence, short reason kept; ID image deleted after 30 days and with the account; included in "Your data"; deleted with the account | TRUE (all but the EU location) | `openrouter.ts:89` (pin, `zdr`), `document-check.ts:138-162`, `ai/rules.ts:26-45` (reason stripped of dates and long numbers), export.ts:65, account.ts:14 (cost record stays, owner set to null) | EU location: UNVERIFIABLE (provider pinned to `google-vertex`, region not set in code). Also: the cost record without owner stays after deletion; say so or accept |
| D-20 | same, point "Open 1": "Sign-up does not yet require accepting the Terms" | WRONG (stale) | Checkbox is built: `sign-up-screen.tsx:49`, `terms-checkbox.tsx`; acceptance stored; re-accept pop-up | Delete the open point |
| D-21 | `legal-pages-drafts.md` open items: "A sign-up checkbox ... is not built yet" | WRONG (stale) | Same | Delete |

### 3.5 DPIA draft and the Article 50 note

| Ref | Source | Claim | Class | Evidence | Corrected wording / action |
|---|---|---|---|---|---|
| E-1 | DPIA 1 and 1a | AI may approve by itself when every check passes; never rejects; target about 90% decided without a person | TRUE (never rejects, auto-approves); the 90% is a target, not measured | `wouldAutoApprove`, ai/rules.ts:40; `document-check.ts:138-162`. Measured on 20 made-up documents: 17 right, none wrongly approved (`Reports/ai-document-check-evaluation-2026-11-03*.md`, not re-run) | |
| E-2 | DPIA 1a, risk 5 | About 10% sample "re-check afterwards; wrong approvals are withdrawn" | WRONG | A sampled document is sent to staff before it is approved (`sampled`, document-check.ts:139-143); nothing is ever approved and later withdrawn | "About one in ten of the documents the AI would approve goes to a person first." |
| E-3 | DPIA 1a | Police certificate (any) and the extended certificate for babysitting: always staff, no automatic approval | NOT BUILT | `wouldAutoApprove` has no document-type exception; only the photo ID needs an expiry date (`needsExpiry`, rules.ts:40). README:85 says the rule is the same for every type | Build the exception (one condition on `requirement`), or change the DPIA and the legal text 5a.2 ("any document type may be approved automatically") |
| E-4 | DPIA 1a | Provider's first [50] approvals, and any provider with an earlier rejection, always staff | NOT BUILT | No such rule in `document-check.ts` | Build or delete |
| E-5 | DPIA 2 and risk 5 | "automatic approval can be switched off per document type with one setting" | NOT BUILT | One global switch only: `AI_DOCUMENT_MODEL` unset (document-check.ts:33-47) | Build or change to "off for all types" |
| E-6 | DPIA risk 5 and 9 | "reviewer must open the document before the buttons work" | NOT BUILT | `apps/web/app/admin/documents/show/[id]/page.tsx:67`: only Reject needs a note; Approve is always active | Build or delete |
| E-7 | DPIA "What the AI returns" and flow step 3 | "The fields are stored next to the document as advisory data" (document type, name, issuer, issue date, expiry, flags) | WRONG | Stored: verdict, confidence, a short reason without numbers or dates, model, spot-check flag, decision, cost (`document_ai_checks`, README:87; export.ts:65). Nothing read from the document is stored (the legal text 5a.3 is right) | Update the DPIA to the stored list |
| E-8 | DPIA risk 12 | "Clear notice at upload and in the privacy policy" | WRONG (decision changed) | Owner decision of 3 November: nothing on screen for the document check (DPIA 2 Transparency says so itself; `phone-test-flow-1.md` Part 6) | Remove "at upload" |
| E-9 | DPIA risk 5 and 4 | Monthly approval and error rates reported; agreement tracked | NOT BUILT | No report or screen computes it; the back office shows each check read-only (README:89) | Build a count query, or drop |
| E-10 | DPIA risk 9 | Signed links valid 5 minutes; documents never public; roles; staff actions logged | TRUE (links, private, roles) / partly (logged) | `getSignedUrl(..., 300)`, documents.ts:78, admin/documents.ts:63; logging: D-18 | |
| E-11 | DPIA risk 6 | AI has no tools or internet; fixed instruction and output format; answers outside the format discarded; AI answer never changes the status beyond approve | TRUE | `openrouter.ts:80-100` (no tools, JSON mode, native PDF parser only), zod check | |
| E-12 | DPIA retention | Document kept while account exists and 6 months after deletion | TRUE except the photo ID | A-18 | Add "except the photo ID image, deleted at once" |
| E-13 | DPIA addendum 7 | ID card scan: photo in memory, not stored; 10 per person and hour; shared EUR 20 cap; same two switches; date of birth stored privately and deleted with the account | TRUE | id-scan.ts:11,47,91-107; account.ts (users row deleted) | |
| E-14 | DPIA 1 and 2 | EU servers, zero retention, no training, processing agreement signed | UNVERIFIABLE | Requested in code, cannot be proven (Article 50 note says so) | Owner: written confirmation from OpenRouter and the model provider; agreement signed (Q-3) |
| E-15 | `article-50-note.md` table | Translation labelled; document check shows nothing on screen; ID scan has a short note above the button; no quote assistant | TRUE | `provider.translatedLabel` en.ts:73; `idScan.note` en.ts:402; no quote-assistant code | |
| E-16 | Article 50 note, "Consent record" | "a person cannot register without ticking the terms and privacy policy" | TRUE in the app only | The tick is checked in the app (`sign-up-screen.tsx:49`) and the acceptance is saved after the email code. A sign-up made directly against the login service has no acceptance; those accounts are skipped by the AI check (`termsCurrent`, id-scan.ts:97) but not blocked (README:130 "the terms gate for accounts that never accepted") | EN: "...in the app a person cannot register without..." |
| E-17 | Article 50 note, "Open" | "The terms and privacy pages are unpublished drafts, so the disclosure is not yet visible" | UNVERIFIABLE | Same as U-1 | Owner |
| E-18 | Article 50 note: "AI result and cost records ... removed or anonymised on account deletion" | TRUE | `ACCOUNT_TABLES` comment, account.ts:14 | |

### 3.6 README (sections that describe the app)

| Ref | Line | Claim | Class | Evidence | Corrected wording |
|---|---|---|---|---|---|
| F-1 | 15 | "Four tabs at the bottom: Home, Search, My profile (only for providers) and Account" | WRONG | Home, Search, Jobs, "My business" (providers only), Account: `apps/mobile/src/app/(tabs)/_layout.tsx:75-79`, `tab.jobs`, `tab.myProfile` en.ts:82-83. "Booking lists ... open from Home" is also stale: Jobs is its own tab | "Five tabs: Home, Search, Jobs, My business (only for providers) and Account." |
| F-2 | 17 | "There is no age or terms tick yet." | WRONG | `sign-up-screen.tsx:49`; README:158 says the opposite | Delete the sentence; say "a tick for age 18 and terms" |
| F-3 | 28 | "One open request per customer and provider" | WRONG | Up to 5: rules.ts:20; README:150 says 5 | "At most 5 open requests per customer and provider" |
| F-4 | 20 | "a translate button (OpenRouter, limited per person and per day)" | WRONG (small) | N-34: 30 per person and hour; 2000 per day in total | |
| F-5 | 19 | Search: published, not suspended, at least one offerable service; 20 per page; radius; remote | TRUE | search.ts:8,79 | |
| F-6 | 21 | My profile cards; past jobs 2; portfolio 12; skills and strengths 20; default radius 25; required fields | TRUE | N-25, N-26, A-26 | Tab is called "My business" now |
| F-7 | 22-28 | Request, provider answer, confirm, booking, quote documents; 2 days; 7 days; busy times; 50 per list | TRUE | N-16 to N-19; `LIST_PAGE = 50`, contract/common.ts:24 | |
| F-8 | 29 | Paying only when payments are on; verified mark; notify me; 60 days | TRUE | N-20; public-profile.ts:105 | |
| F-9 | 30 | Finishing, cancelling, disputes, reviews, stop job, additional task | TRUE | N-1 to N-15 | |
| F-10 | 31 | Chat | TRUE | N-24 | |
| F-11 | 32 | "Notices, push and email: 40 notice kinds; each goes by push if the phone has a token and the switch allows it, otherwise by email" | TRUE | N-37, A-21 | |
| F-12 | 33-34 | Invoices (PDF, yearly CSV, monthly commission invoices); Account: export, delete (password) | TRUE | `invoices/issue.ts`, `invoices/export.ts`, `commission.ts`, account.ts | Invoices appear only after the booking is settled (H-4) |
| F-13 | 38-42 | Website and back office | TRUE | footer.tsx, `[slug]/page.tsx`; roles `administrator` and `reviewer` (en-server.ts:178-179) | |
| F-14 | 44-53 | Cron table 03:00, 04:00, 05:00, 06:00 UTC and what each does | TRUE | `apps/web/vercel.json:10-23`; retention numbers N-33 | |
| F-15 | 59-61 | Money: separate charges and transfers; commission fixed per booking; append-only ledger; test keys only; delete and export | TRUE | `payments/rules.ts:7-17`; account.ts | |
| F-16 | 83-91 | AI check: header says "built, off until the key and a model are set"; elsewhere "live in production since 3 November" (README:157,173,192) | UNVERIFIABLE | Code: on only when `OPENROUTER_API_KEY` and `AI_DOCUMENT_MODEL` are both set (document-check.ts:33-47). The session log says they are set on Production (`docs/history/2026-11-session-log.md:88`). The header contradicts the rest | Owner: look at Vercel Production variables. Then fix the header |
| F-17 | 101 | "all 69 app-api/v1 routes use appRequest" | TRUE | 69 `route.ts` files, all contain `appRequest` (counted) | |
| F-18 | 100 | Test counts (web 102 files / 1039 tests, mobile 409, domain 321, contract 33, i18n 18) | UNVERIFIABLE | Not run here; there are now 103 web spec files | Owner or CI |
| F-19 | 155-161 | "What the app cannot do yet": no quote assistant; not in stores; no "report this profile or photo"; no deletion web page; Help and Feedback placeholders; payments test only; no availability calendar | TRUE | No such code found; A-12; LIVE_PAYMENTS_ALLOWED | This list is the right source for Help's "not yet" section |
| F-20 | 117 | "Production still says 12%" | UNVERIFIABLE | Page content in the production database | Owner: edit in `/admin` before publishing |
| F-21 | 63, 97-99 | Production = Neon `kando-main`, migrations 0000 to 0036 applied, Android preview build talks to production | UNVERIFIABLE | Dashboards | Owner |
| F-22 | 133 | "https://skillweb.space is only a landing page" | TRUE | page.tsx | |
| F-23 | 189 | "no screen sets a provider's legal status or VAT id, so every provider is 'private' and gets receipts" | TRUE | `invoices/rules.ts:6` (VAT rate table); no profile field for legal status in `ProfileInputSchema` (my-profile.ts:40-52) | Help must not promise VAT invoices for businesses |
| F-24 | 190 | Insurance, trade registration, craft qualification optional in every category | TRUE | categories.ts:13-26. Required beyond the photo ID: babysitting police certificate, dog walking permit, catering hygiene certificate and food business registration (seed; production values can be edited in the back office: UNVERIFIABLE) | |

### 3.7 Design papers (`docs/specs/`)

These papers are plans, dated 26 and 27 October. Anything below that a reader could take as built is classified against the code today. The papers carry no "superseded" banner: add one.

| Ref | Source | Claim | Class | Evidence |
|---|---|---|---|---|
| G-1 | Foundation 2.1(3), 4.3 | "The customer enters a payment method at booking; nothing is charged ... the agreed amount is then charged" | WRONG | The customer pays the full amount on Stripe's page before the job; the money is released after confirmation (README:29-30; `payments/rules.ts`) |
| G-2 | Foundation 2.1(2) | Two booking styles: direct and request | WRONG | Direct booking removed (README:28, migration 0028); only request, quote, confirm |
| G-3 | Foundation 4 | Background jobs on Inngest; realtime chat on Neon Realtime | NOT BUILT | Vercel cron routes (`vercel.json`); chat polls every 4 s (`POLL_SECONDS`, chat/rules.ts:16) |
| G-4 | Foundation 4.3 | Rating visible after 14 days; request deadline 1 to 7 days, default 3 | WRONG | 7 days (`REVIEW_VISIBLE_DAYS`, ending-rules.ts:5); fixed 3 days (`REQUEST_ANSWER_DAYS`) |
| G-5 | Foundation 4.3 | Hourly and "from" prices: estimate and a cap 20% above it, final amount at completion | NOT BUILT | No such logic (searched bookings and quotes); a quote carries one amount |
| G-6 | Foundation 2.1(4) | Invoices with labour and material split (section 35a EStG), DAC7 data collection, Preise page | NOT BUILT / WRONG | Material lines removed (README:151); DAC7 data are only collected inside Stripe's onboarding (`stripe-gateway.ts:78`); no Preise page |
| G-7 | Foundation 4.3 | Widerruf: consent to early performance and "Button-Loesung" in the booking flow | NOT BUILT | Nothing in the booking flow or texts; lawyer question README:249 |
| G-8 | Foundation 2.1(5) | Second provider no-show in 12 months triggers a 30-day suspension with the reason shown and an appeal | WRONG | Staff get a flag and suspend by hand; no appeal flow (cancel.ts:181-182) |
| G-9 | Foundation 4.3 | Failed charges are retried; the customer is blocked from new bookings until paid | NOT BUILT | Checkout payment, no card-on-file, no retries |
| G-10 | Foundation 4.3 | Cancellation "free up to 24 hours for both sides; later cancellations ... shown in ratings; customer never charged for a provider no-show" | WRONG (customer side) | A late customer cancellation costs 50% (N-2); provider's late cancellation is a count on the profile (N-4) |
| G-11 | Foundation 4.3 | Chargebacks after payout deducted from the provider's next payout only when the decision went against the provider | NOT BUILT | A dispute after payout is a manual platform matter (`payments/rules.ts:21-26`) |
| G-12 | Foundation 2.1(6) | Messaging "delivered in realtime", "read markers" | NOT BUILT | G-3; README:181 lists read markers as later |
| G-13 | Foundation 2.1(5), 4.3 | Verified mark = Stripe onboarding complete | TRUE | public-profile.ts:105 |
| G-14 | Foundation 4.3 | Legal pages by slug `/impressum`, `/datenschutz`, `/agb`, `/ranking` | TRUE | footer.tsx:7-10 (content: U-1) |
| G-15 | Foundation 4.3 | Data residency: everything in Frankfurt incl. Resend EU | UNVERIFIABLE | A-3 |
| G-16 | Registration design 2 | "Complete means: profile picture; ... experience" | WRONG | The picture and the experience text are optional (`Missing` enum, my-profile.ts:8; `profile.ts:51`) |
| G-17 | Registration design 3 | Warning email: "A second warning suspends your profile for 30 days" | WRONG | N-7: the notice and email say "can suspend"; suspension is a staff decision |
| G-18 | Registration design 3 | A suspension ends by itself at its end date; "published again" email | TRUE | `suspended_until`; `endExpiredSuspensions` (cron suspensions); `email.publishedAgain` en-server.ts:116 |
| G-19 | Registration design 1 | The address is shown to a provider only after they accepted a job | WRONG (timing) | D-14: after the customer confirms the quote |
| G-20 | Registration design non-goals | "Push notifications ... come with bookings and chat" | TRUE | Built (`push.ts`); credentials: A-21 |

### 3.8 Phone-test script (`docs/phone-test-flow-1.md`)

| Ref | Line | Expected behaviour stated | Class | Evidence | Fix |
|---|---|---|---|---|---|
| H-1 | Part 0 | Sign-up shows an unticked box with links; the links "show not found until the pages are published" | TRUE / UNVERIFIABLE | `terms-checkbox.tsx:10`; page state: U-1 | |
| H-2 | Part 1 | "The street is not shown to the provider before the booking is accepted and paid." | WRONG | Hidden only until the customer confirms the quote (`hideStreet`, requests.ts:269; booking view requests.ts:172, confirm.ts:85); payment comes after | "...before the customer has accepted the quote." |
| H-3 | Part 4, table | Declined card: "the booking is not created, you can try again" | WRONG | The booking already exists as "awaiting payment" after the customer confirmed the quote; a declined card changes nothing and the customer pays again until the pay-by time (`job.state.checkout_not_completed`, en.ts:887-890: "Nothing was charged. Pay again.") | "No charge is made; the booking stays 'waiting for payment' and you can pay again." |
| H-4 | Part 4, table | Paid card: "a receipt or invoice exists" | WRONG | An invoice or receipt is issued only after the booking is settled (completed, cancelled with payout, and so on) and has a payout line: `isDue`, `invoices/issue.ts:36-57`; the notice `invoice.none` says so (en.ts:850). A full refund produces none | "After the job is completed and settled, an invoice or receipt appears." |
| H-5 | Part 5 | Chat arrives within about 4 seconds; sixth open request refused; "Your data" mentions the terms acceptance time; deletion with wrong password refused | TRUE | N-24, N-22; export.ts:52-53; account delete route | |
| H-6 | Part 6 | The person sees nothing extra on screen for the document check; an account without accepted terms goes to staff with the reason "terms not accepted" | TRUE | `admin.ai.failure.terms-not-accepted` en-server.ts:160 | |
| H-7 | Part 7 | 11th ID scan in an hour is refused | TRUE | `SCANS_PER_HOUR = 10`, id-scan.ts:11 | |
| H-8 | Part 5 | "Two customers confirming the same time: only one wins" | TRUE | `error.booking.slot-pending` en.ts:569; buffer 30 min `BUFFER_MINUTES`, rules.ts:10 | |

### 3.9 Store, listing and marketing claims

| Ref | Source | Claim | Class | Evidence | Action |
|---|---|---|---|---|---|
| I-1 | No store listing, screenshot set or marketing text exists in the repository (searched `docs/`, `Reports/`, `apps/mobile`). The README lists the listing as a task (README:224) | none | n/a | | Write the listing from section 4 only |
| I-2 | `apps/mobile/locales/en.json`, `de.json` (iOS permission texts) | "KANDO uses the camera for your provider profile and documents." / "...your photos for your provider profile." | WRONG | The camera and photo library are also used for the customer's own picture, request photos, chat photos and the ID card scan (`request-form.tsx:33-50`, `id-scan-button.tsx`, `account-screen.tsx:149`). Apple compares the text with the use | EN: "KANDO uses the camera to take pictures for your profile, documents, requests and messages, and to read your ID card if you choose to." DE analog |
| I-3 | `apps/mobile/app.json:3-4` | App name "KANDO", slug "skilled" | TRUE | The name matches the texts; the legal drafts say "SkillWeb" (I-4) | |
| I-4 | Product name | Texts, emails and app say "KANDO" (`brand.name`, en.ts:4, de.ts:2); legal drafts, section 8a, privacy drafts and the domain say "SkillWeb"; README title says both | WRONG (inconsistent) | Foundation design: "SkillWeb for now ... it may be renamed KANDO later, so the name is a single setting" | Decide one name for users and legal pages (Q-8) |

---

## 4. Facts safe to use in the Help content

Every line below was checked in the code. "(UNVERIFIED)" items are not safe yet and are listed in section 5.

### 4.1 What the app is
- A marketplace on the phone for Germany: customers find a provider, send a request, receive a quote, accept it, pay, and confirm the job. Providers set up a profile with services and prices. (README:3; booking code under `packages/domain/src/bookings`)
- German is the main language, English is complete (1008 + 353 texts with identical keys).
- The website shows the home page, public provider pages and the legal pages; bookings happen only in the app (`web.getAppText`).
- The app is not in the app stores; payments run in Stripe test mode only; live payments are blocked in code (`LIVE_PAYMENTS_ALLOWED = false`, payments/rules.ts:7).
- Customers pay no fee on top of the price. Providers pay a commission of 15 percent of the booking amount, payment fees included, only when a job is paid; there is no lead fee and no subscription (provisional rate, `COMMISSION_RATE`).
- There is no availability calendar and no instant booking; busy times (30 days) are shown as times only.
- Help and Feedback in the banner are placeholders today.

### 4.2 How it works (customer)
1. Search by category, 5-digit postcode and text; 20 results per page; nearest first, then by name; remote providers always show; ratings are shown but do not change the order (search.ts).
2. On a provider page: "Request a quote" or "Book" (fixed-price services); both open one request form (what, date, time, duration, on site or remote, address, note, photos). A date and time are required.
3. The request goes to that one provider. At most 5 open requests per provider and 10 requests per day. The provider has 3 days to answer.
4. The provider sends a quote (valid 7 days), with or without a confirmed date and time, or declines. Several quotes can exist side by side. Once a quote exists the request cannot be changed; talk in the chat. The customer can withdraw the request.
5. The customer accepts the quote, which creates the booking. With a confirmed time the booking waits for payment; without one, either side enters a time and the other confirms it within 2 days (7 days to agree at all, else it lapses).
6. The customer pays on Stripe's page (full amount, minimum EUR 0.50). The pay-by time is 48 hours after acceptance but at least 24 hours before the start (6 hours when the start is 24 hours or less away). A time more than 60 days ahead cannot be paid. The booking is confirmed when Stripe reports the payment. A declined card changes nothing: the customer can pay again until the pay-by time.
7. A lapsed booking (not paid in time, or no time agreed) shows "Do you still want it?" with "Yes, book again" or "I don't need this anymore".
8. The provider's street address is shown to the provider from the moment the customer accepts the quote (on-site jobs), not before.

### 4.3 Who can do what
- One account can be customer and provider. A provider profile is created with "Offer services".
- Only the answering side accepts or declines (database trigger, README:57). Only the server moves a booking to confirmed.
- Staff roles: administrator and reviewer; the reviewer cannot see providers' payment or tax data (README:42; not re-verified here).
- Either side can block the other in a chat, and report a message. Nothing exists to report a profile or a photo.
- A customer cannot book a provider who has not finished payout set-up; the customer can tap "Notify me when available". The provider is told that customers are waiting (at most once per 24 hours), without names.
- A provider cannot send quotes until payout set-up is done and the provider has agreed that invoices are issued in their name (and, for a small business or business, has entered a tax number or VAT id), while payments are on (`quoteSteps`, payments/rules.ts:64-71).

### 4.4 Money and fees
- Commission 15 percent of what the customer pays, payment fees included, deducted from the provider's payout. On a late cancellation it applies to the 50 percent share only. On a full refund there is no commission. (`cancel.ts:78`)
- The provider sees "You receive" before sending a quote (`money.quotePreview`, en.ts:981).
- The money is paid to the provider when the customer confirms the job, or 7 days after "Finished" if nobody reports a problem; a reported problem stops the payout until staff decide. (finish.ts, N-8)
- Stripe holds the money until then (separate charges and transfers; funds are in the platform's Stripe balance). Whether to say "held" is a lawyer question (Q-1).
- When the money reaches the provider's bank depends on Stripe's payout schedule (daily automatic payouts are set; the 7-day statement is UNVERIFIED, N-39).
- Providers with a Stripe-verified payout account get the "Verified" badge while payments are on.
- Additional task: a separate booking linked to the job, with its own quote, payment, clock and payout; work on it starts only when it is accepted and paid. If the main booking is cancelled, its paid tasks are cancelled by the same rule. (`additionalTask.explainer`, en.ts:648; cancel.ts:79-82)
- Dates and times on screen follow the phone; emails, invoices and the 24-hour cancellation rule use German time (README:124).

### 4.5 Cancelling
- Customer, more than 24 hours before the start: free, full refund (can take a few days). Less than 24 hours: 50 percent goes to the provider (minus commission), the rest returns. Exactly 24 hours before is still free.
- Provider cancels: the customer always gets everything back. A cancellation less than 24 hours before the start counts on the provider's public profile for 12 months.
- After the start a booking can no longer be cancelled: stop the job or report a no-show.
- An unpaid booking is withdrawn, not cancelled.

### 4.6 No-show, stop, disputes
- No-show: possible only from the start time. The other side has 48 hours to object; without an objection the report stands. Customer no-show: the provider gets the full price minus commission. Provider no-show: the customer gets everything back, and the provider gets a warning; a second one within 12 months is flagged to staff, who can suspend for 30 days.
- Stop job: either side stops a started job; the provider states what was earned (0 up to the price); the customer agrees (pays that amount, refunds the rest) or disagrees (staff decide); no answer in 7 days, staff decide.
- Dispute: either side can report a problem after "Finished" until the 7 days run out, or after a stop; the customer also after "Was the job done?". Staff decide within 14 working days (Monday to Friday, public holidays not excluded), with a written reason: full payout, partial amount or full refund. No money moves until then.
- If nobody acts within 7 days after the end of a job, the booking goes to staff.

### 4.7 Reviews
- After a completed job both sides can write 1 to 5 stars and an optional text, once, within 7 days.
- Reviews are blind: the other side sees yours when both are in or 7 days after completion. You can change yours until it is shown, at most 14 days.
- Staff can hide a review with a reason (only the author sees that it is hidden).
- Only completed (paid and released) jobs can be reviewed.

### 4.8 Invoices
- Invoices and receipts are made in the provider's name with the provider's own numbering, after the booking is settled (not at payment); PDF in the provider's language; a yearly CSV export for the provider; monthly commission invoices from the platform to the provider. (issue.ts, commission.ts)
- While payments are in test mode every number starts with "TEST-" and the PDF carries a test watermark (`numbering.ts:30`, `pdf.ts:5`).
- Every provider is treated as a private person today (no screen sets legal status or VAT id): do not promise VAT invoices (README:189).
- The platform's own company details are placeholders until the legal entity is filled in; real documents are blocked while payments are live and the details are missing (`entity.ts`).

### 4.9 Data and privacy
- Export: the app can export your account details, profile, services, files, requests, quotes, bookings, your messages, your reviews, notices and AI check results as JSON or CSV. It does not include invoices, the money ledger or disputes (A-16).
- Delete: needs the password; refused while a booking holds money or an invoice is missing; removes your profile, photos, files, requests, quotes, bookings, reviews and the chats (also for the other side) at once; the photo ID image goes at once; for providers or people who submitted documents the other documents and basic trader details are kept 6 months and then deleted automatically; invoices, commission invoices, the money ledger and the AI cost record are kept. (account.ts)
- Retention in the code: notices 180 days after seen, Stripe events 90 days, push tokens 270 days, blocked contact text 90 days. Chat messages stay until the account is deleted.
- Addresses: postcode, street and city are private; a provider sees a customer's street only after the quote is accepted; the public page shows the provider's public name (first name and first letter of surname, or business name), picture, texts, services, prices, area and past jobs.
- Documents are private: visible only to you and staff through 5-minute links; customers see only the names of approved documents.
- Chat: contact details (phone, email, links, also written in words) are refused; this is a rule check and can be bypassed.
- No analytics or tracking tool is installed in the app or website.
- The terms must be re-accepted after a change; until then you can read but not change anything.
- Sign-up needs an email confirmed by code, a tick for "18 or older and accept terms and privacy".

### 4.10 Providers' setup
- Publish needs: a name, one service (category and price type), provider type (a business also needs a business name and a legal notice), at least one strength, one skill, postcode, service radius (1 to 200 km, default 25). Picture and experience text are optional.
- Limits: 2 past jobs, 12 portfolio photos, 20 skills; photos are for the public profile.
- A service goes live only when all documents required for its category are approved; other services show at once; the profile shows "Live, N service(s) waiting for a check".
- Suspension ends by itself on the end date.
- Quoting needs payout set-up with Stripe (about 5 minutes, per the app text), consent to invoices in the provider's name and, for small businesses and businesses, a tax number or VAT id.

### 4.11 Documents and verification
- Photo ID is required from every provider in every category. Further required documents per category (seed; staff can change them in the back office): babysitting police certificate (the extended one), dog walking permit, catering hygiene certificate and food business registration. Optional everywhere: liability insurance and trade registration; optional for some: police certificate (cleaning, dog walking), first-aid certificate (babysitting), craft qualification (small repairs).
- Optional approved documents show as badges ("Checked documents": names only).
- File types JPEG, PNG, WEBP, and PDF for documents; about 4.5 MB.
- A document can be deleted only if another one exists for the same requirement (`error.replacementFirst`); deleting an approved document takes dependent services offline.

### 4.12 AI use
- Translate button on provider pages (website and app): public texts of the provider go to an AI model through OpenRouter; the text is labelled "Automatically translated (AI)" with "Show original"; limits 30 per person and hour, 2000 per day in total.
- Document check: an AI model reads an uploaded document once; if it finds no problem and is at least 80 percent sure it may approve it; a person checks about one in ten of those; problems, doubts, errors, limits go to staff; the AI never rejects. Stored: verdict, confidence, a short reason without numbers or dates. Photo ID images are deleted 30 days after the check and with the account. Nothing about it is shown on screen; the information is in the terms accepted at sign-up.
- ID card scan (optional, in Account): the photo is read once to suggest name, date of birth and address; nothing is stored until you tap Save; the photo is not saved.
- No chatbot and no AI quote assistant exist.

---

## 5. Open questions only the owner or the lawyer can answer

**Owner checks (dashboards and published content)**

- **U-1 Terms page `agb`:** is it published in German and English on production, and does the text match section 8a with 15 percent (README:117 says production still shows 12 percent)? Does it contain the AI sections 5a and 5b?
- **U-2 Privacy page `datenschutz`:** published? Does it contain 4a (AI check), 4b (payments, Stripe), 4c (ID scan), Expo as a processor, the retention lines, and the corrected wording for deletion (rows D-8, D-13, D-14)?
- **U-3 `impressum` and `ranking`:** README:130 says 404. A reviewer clicking the footer link must not see an error. The Ranking text must say reviews exist but do not change the order (D-2).
- **U-4 Production environment:** `PAYMENTS_ENABLED`, `OPENROUTER_API_KEY`, `AI_DOCUMENT_MODEL`, `AI_DOCUMENT_PROVIDER`, `DELETE_RETENTION_MONTHS` (if not 6, the app text of A-18 is wrong).
- **U-5 Neon Auth:** session length (7 days?), failed-login lockout (10 minutes?), code length (6?), code expiry, "Require email verification", cookie settings (N-38).
- **U-6 Neon region:** is the project really in Frankfurt (docs/deployment.md:9)?
- **U-7 Resend:** sending domain verified; EU region; retention period.
- **U-8 Vercel crons:** README:128 plans to pause `/api/cron/suspensions` and `/api/cron/invoices` until 31 January 2027. While paused, ID images are not deleted after 30 days, retained trader records are not purged after 6 months, notices are not pruned, and invoices are not issued. The texts promise all of that.
- **U-9 Stripe:** payout schedule and first-payout delay for a new German connected account (N-39); the sandbox is shared with another project (README:118).
- **U-10 Push:** Android FCM credentials uploaded? Without them no push reaches Android phones and every notice falls back to email (A-21).

**Owner decisions**

- **Q-8 Product name:** KANDO (app, emails, website) or SkillWeb (legal drafts, domain)? The legal pages and the Impressum must use the name users see (I-4).
- **Q-9 Website entry point:** the home page has no link into the app or a store; for a reviewer, a "Download" or "Open in the app" path (README:133).
- **Q-10 Which "Verified" meaning** to keep (A-13), and whether the home text may say "KANDO checks documents" next to it.
- **Q-11 Hide the Help and Feedback buttons** until PR 6 and 7a ship, or keep them (A-12).
- **Q-12 Decide on the DPIA mismatches** (E-3 to E-6, E-9): build them (police certificate always to staff, first documents to staff, per-type switch, reviewer opens document first, monthly counts) or change the DPIA and the legal text 5a.2 to describe what is built.
- **Q-13 Age:** keep the tick only, or read the date of birth for an age check; providers from 16 (README:254-258).
- **Q-14 Chat retention:** messages are kept until the account is deleted; choose and state a period.

**Lawyer and tax adviser**

- **Q-1 Wording of "held":** "Your money is held by a licensed payment provider" and "held safely" (A-4, A-27) against the ban on "Treuhand", "Escrow", "Garantie" and the 8a draft that avoids "held". In the code the funds sit in the platform's own Stripe balance until the transfer to the provider (`payments/rules.ts:11-17`).
- **Q-2 Cancellation fee for consumers:** 50 percent after 24 hours, full price for no-show, and the 14-day right of withdrawal (README:249-250). The texts and the code already apply them.
- **Q-3 AI processors:** signed agreements; EU data location of the pinned model provider; the Article 22 safeguards; whether the small label on AI-written text can go.
- **Q-4 Entity data:** legal form, address, register, VAT rule for the Impressum and for `PLATFORM_ENTITY` (placeholder in `invoices/entity.ts`).
- **Q-5 Retention:** how long invoices, payment records and the ledger must be kept (they survive account deletion today), the 6-month trader record (whether the duty applies), chat retention.
- **Q-6 Disputes:** may staff decide, is the decision binding, what must the site say about out-of-court resolution (README:251).
- **Q-7 Children's data and providers from 16** (README:254-258).
- **Q-15 Tax:** commission amounts treated as gross; business invoices; VAT on cancellation fees (README:260).
