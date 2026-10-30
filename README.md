# KANDO: SkillWeb rebuilt

The new home of SkillWeb, a service marketplace for Germany. The goal: households book trusted, verified local helpers and small businesses, pay when the job is done, and get the paperwork included. **Today the app is a directory: people can find and read about checked local providers, and providers can build a profile. Requesting, quoting and booking exist since Stage 2a (merged as pull request #25); paying and rating are not built yet; chat exists on the Stage 2b branch (not merged yet)** (see "What the app does today"). This repository replaced the earlier Payload-based repository (`SkillWeb`). Since 28 October 2026 https://skillweb.space (and `www`) is served by this project; the old repository, Vercel project and local folder are being deleted (see "Retiring the old Payload stack").

- **Design:** `docs/specs/2026-10-26-kando-foundation-design.md` (what the first release does, the decided stack, the rules, the stages). The registration and provider-setup design is `docs/specs/2026-10-27-registration-and-provider-setup-design.md`; its plan is in `docs/plans/`.
- **Stack today:** Expo app (`apps/mobile`); Next.js on Vercel for the website, the staff back office (Refine, German and English) and the API (`apps/web`); Neon Postgres with PostGIS and row-level security, Neon Auth and Neon Object Storage; Drizzle (`packages/db`); business rules in `packages/domain`; shared input rules in `packages/contract`; one text catalogue in German and English (`packages/i18n`); Resend for email; OpenRouter for the translate button. **Planned, not built yet:** Inngest for background work, Stripe behind a payments interface, Neon Realtime for chat.
- **Rules for this project:** every change through a pull request merged by the owner (use "Squash and merge" and delete the branch); a test report in `Reports/` after every stage and every big change; no competitor names anywhere; commit co-author trailers from Claude are tolerated for now (owner, 28 October 2026; the earlier rule was none), pull request descriptions carry no "Generated with" line; every user-facing text exists in German and English; South Africa follows later, so no new Germany-only assumptions.

Layout: `apps/mobile`, `apps/web`, `packages/db`, `packages/contract`, `packages/i18n`, `packages/domain`, `Reports/`, `docs/`.

## What the app does today (28 October 2026, everything merged into `main`)

Honest short version: sign up, log in, build a provider profile with services, documents and photos, have staff check the documents, and let anyone search and read published provider profiles. Customers can now ask a provider for a quote or book a fixed-price service, and providers can quote, accept, counter or decline (Stage 2a, branch `stage-2a-bookings`, see "What was built"). **Payments are built (Stage 2c, branch `stage-2c-payments`, not merged yet) but switched OFF** (see below); with the switch off a booking still ends in "awaiting payment" and nobody can pay. There is no way yet to rate a provider. A chat per request and booking exists on the Stage 2b branch `stage-2b-chat` (not merged yet). All of it is live at https://skillweb.space on an empty production database; nothing from pull requests #14 to #20 has been seen on a phone yet.

**Phone app (Expo, German and English)**
- **Sign-up and login:** email and password (at least 8 characters), the email is confirmed with a code; password reset by code; the session lasts 7 days. Sign-up asks for first name, surname, email, password, an optional picture, an optional address (only the postcode is required if you give one) and a switch "I also want to offer services". There is no age or terms tick yet.
- **Home:** headline, "Find help now" button, a category list that opens a search for that category, a picture reminder (until the person has a picture), a "Become a provider" card (for people without the My profile tab) and information cards.
- **Search:** category, 5-digit postcode and free text (provider name or skill). It lists published, not suspended providers with at least one service whose required documents are approved, sorted by distance when a postcode is given (a provider only shows within their own service radius; remote providers always show), 20 per page, refreshed when you return to the tab.
- **Public provider page:** picture, public name (first name plus the first letter of the surname, or the business name), place, categories, "Checked documents: ..." (approved document names only), a translate button (translates the provider's texts with OpenRouter, limited per person and per day), strengths, skills, experience, services with prices (fixed, per hour, from, on request), past jobs, portfolio photos and, for businesses, the legal notice. Customers can request a quote (every service) or book directly (fixed-price services only) from here; the greyed-out "Send request" button is gone.
- **My profile tab (providers only):** compact cards that roll up, each with its own edit screen: Services, About you, Past jobs (at most 2), Portfolio (at most 12 photos) and Verification documents; the profile picture; autosave; Publish and Unpublish. Rules are under "How it works now".
- **Account tab:** edit name and address, "Offer services", log out, export my data (JSON or CSV), delete my account, and a link to the back office for staff. A dot shows when a notification has not been seen.
- **Requests, quotes and bookings (Stage 2a):** a customer writes a request and the provider sends a quote (revisable; a quote is valid 7 days and the customer is told so); the customer accepts and proposes date, time and duration (on-site or remote); the provider accepts, counters or declines; the customer can withdraw ("I no longer need this"). A fixed-price service can be booked directly with a proposed time. Busy times of a provider are respected (first come, first served, with a travel buffer between on-site jobs). Decline and withdraw ask for confirmation. The booking ends in "awaiting payment" with a placeholder pay link; **no money moves**.
- **Payments (Stage 2c, branch `stage-2c-payments`, built and reviewed, switched OFF and test mode only):** with `PAYMENTS_ENABLED=true` a customer pays an accepted booking by Stripe's hosted page (the full amount; "Pay now" in the booking, the app waits up to 10 minutes for Stripe's confirmation) and the booking becomes **Confirmed** once Stripe tells the server it is paid; a failed or abandoned payment leaves it awaiting payment. Stripe holds the money (separate charges and transfers; the commission is fixed per booking when it is paid and the ledger of money movements is append-only). Providers set up payouts through a Stripe-hosted form in the provider setup screen and get a **verified mark** when Stripe says they are ready; a customer cannot request or book a provider who is not ready, but can tap **notify me** (the provider is told at once with the number of waiting customers, then at most daily; the customer gets "Now available"). A booking more than 60 days ahead cannot be paid. **No money is released to providers yet**: finishing a job, the 7-day confirmation, cancellations, disputes and staff refunds are Stage 2d. Only Stripe test keys are accepted (`LIVE_PAYMENTS_ALLOWED = false` in `packages/domain/src/payments/rules.ts`): real payments need the lawyer's points below and a code change of that constant. **Decide the commission percentage: `COMMISSION_RATE` is a placeholder (12%) and must be set before payouts or the Preise page go live.** Not yet tried on a phone, and the real Stripe account is not fully set up (see "Stripe test-mode set-up (owner)").
- **Chat (Stage 2b, branch `stage-2b-chat`, not merged yet):** one chat per request and per booking, with text (at most 2000 characters) and photos, plus quote and acceptance cards posted by the system. **Contact details are blocked at every stage** by the rule: a message is refused (422, with a text in German or English) if it contains an email address (also spelled with "at" and "dot"), a link (`http://`, `www.` or a name ending in a known top-level domain such as `.de` or `.com`), or a phone number: runs of three or more number tokens (digits or number words) are turned into digits, and it counts as a phone number with 7 or more digits starting with `0`, `+` or `00`, or with 10 or more digits (dates, times and prices are ignored). The AI layer is not attempted: social handles, "bei gmail", numbers split by other words, letter swaps, compound number words and other languages can still get through. Three blocked attempts within 24 hours flag the sender to staff. Either person can report a message and block the other person from a chat (by thread). The other person gets an in-app notice and an email for a new message, at most once per 30 minutes per chat; the notice opens the chat (`skilled://threads/<id>`). The app updates the chat by **polling every 4 seconds** (no live push). Request limits: one open request per customer and provider, and at most 10 requests or direct bookings per customer per day. The data export now includes requests, quotes, bookings and the messages you sent. Messages of one person are deleted with their account, the other person's too.
- **Notifications:** "your profile is live" (a banner with a Share button plus a dot on the Account tab) and the booking notices: request received, quote received, time proposed or countered, accepted, declined, expired, quote about to expire, payment reminder, pending slot requested and requests ignored, and (Stage 2b) a new chat message. Each also goes by email in the saved language. The requests-ignored text asks the provider to write to the support address (info@skillweb.space) to confirm they want to stay or to withdraw their services; the app has no confirm button yet.

**Website (Next.js, German and English with `?lang=`)**
- Home page (same content as the app home), public provider pages and sitemaps, and the pages staff publish in the back office (Impressum, Datenschutz, AGB, Ranking and any others) with a footer linking to them. The App Store and Google Play buttons say "soon": the app is not in the stores.

**Back office `/admin` (German and English; staff only)**
- Staff roles: **admin** (everything) and **reviewer** (reads documents, users and providers, reviews documents, suspends users, deletes photos).
- Dashboard (pending documents, suspended users); **Documents** (approve or reject with a note, which sends an email); **Users** (list, filter, suspend with reason and end date, lift); **Providers**; **Categories** (names in both languages, required and optional documents, sort order); **Pages** (legal and information pages, Markdown, German and English); **Staff** (set roles); **Flags** (Stage 2b: repeated contact-detail attempts and reported messages; staff open the reported thread from a flag, and every access, allowed or denied, is written to the table `staff_access_log`).

**In the background**
- Daily at 05:00 UTC (`/api/cron/bookings`, protected by `CRON_SECRET`): expires requests, quotes and bookings, sends the quote and payment reminders and the requests-ignored notice (the expiry rules also run when a person opens their lists). **It runs once a day because the Vercel free plan allows no more; when the project moves to Vercel Pro change its schedule in `apps/web/vercel.json` to `0 * * * *` (hourly), otherwise the 3-hour-before payment reminder only fires if the daily run happens to land inside that window, and short payment windows get no reminder, so payment reminders are effectively off until the timer is hourly (Vercel Pro). Expiry itself is checked whenever someone opens their list, and a lapsed payment window stops blocking the time at once. An unpaid booking expires 10 minutes after its payment deadline (`PAY_GRACE_MINUTES`), so a payment made at the deadline is not refunded because of processing time; no new pay link is given after the deadline.**
- Daily at 06:00 UTC (`/api/cron/suspensions`): ends suspensions whose date has passed (with an email), removes retained trader records after 6 months, retries file deletions that failed.
- Emails through Resend (German or English by the person's saved language): document approved (four variants depending on whether the profile is live, visible, offline or suspended), document rejected, profile live, suspended, published again, account deleted (two variants). Without `RESEND_API_KEY` an email is only logged.
- Data: Neon Postgres with row-level security (users, providers, services, references, photos, private files, documents, notifications, pages, categories with texts, countries, currencies, 10,815 postcodes, translations and their rate limits, pending file deletes, retained records). Photos are stored as JPEG (at most 10 MB in, 12 portfolio photos); documents may be JPEG, PNG, WebP or PDF, at most 4.5 MB (a Vercel limit), at most 10 waiting at once.

**Texts that promise more than the app does:** the "New" badge shows on every profile until ratings exist, and the home page (app and website) describes requests, quotes, in-app payment and "genuine reviews only after paid jobs". Some of those texts say "coming soon" (ID check, in-app payment); the rest describe the plan. **Owner decision (28 October 2026): the texts stay as the plan for now; before any store submission they and the store listing must match what the app really does (START HERE, step 22).**

**Not built:** releasing money to providers (payments are built but off; Stage 2d), finishing a job, disputes, cancellation of an accepted booking, staff refunds, invoices, ratings and reviews, push notifications (live push is stage 2e; the chat polls), Neon Realtime, report or block a profile (reporting and blocking exist in the chat only), the AI layer of the chat contact-detail check (needs an EU provider and a data processing agreement, step 19; until then the check is rules only), a check of numbers inside chat photos, the sign-up age and terms tick, the content of the legal pages, AI document checks, the account-deletion web page, Inngest background jobs, thumbnails.

## START HERE: what must be done to ship a polished first version (most important first)

Written 28 October 2026 so that a new session can continue at once. Status in one line: the app and website work on the new stack and are live at https://skillweb.space on an empty production database; what is missing is mostly owner decisions, legal texts, store requirements and a phone test.

**A. Do these first (they block everything else)**

1. **Merge any open pull request** (`gh pr list`). On 28 October all of #1 to #21 were merged. A database change is needed whenever `rls.ts` or a migration changes: run `pnpm db:migrate` against `kando-dev` and `kando-main` (it also re-applies `rls.ts`).
2. **Decide what version 1 contains.** Stage 2 (requests, quotes, booking, payments with Stripe Connect, ratings, chat, push notifications) is not built. The app today: sign-up and login, search, public provider pages, provider profiles with services, past jobs, portfolio and verified documents, a translate button, account export and deletion, and the back office. Today a customer cannot contact or book anyone, so submitting this as version 1 means a directory only (store text: find verified local helpers; no contact). Decide: submit that, add at least a contact or request step first, or build Stage 2 first. Everything below assumes the first option; the store text and the legal pages must match whatever you choose.
3. **Create the first administrator on production.** Sign up on https://skillweb.space with your own email, confirm the code, then run the one SQL statement in `docs/deployment.md` against `kando-main` (or ask the assistant to do it). Then walk through the back office once.
4. **Phone-test everything** against production (checklist under "Tests that must still be done") and fix what it finds. Nothing from pull requests #14 to #20 has been seen on a screen yet (`Reports/PRs-18-19-20-Test-Report.xlsx` lists the phone checks).

**B. Legal and policy (the stores refuse apps without these)**

5. **Legal pages.** Finish and publish Impressum, Datenschutz (privacy policy), AGB (terms) and Ranking in the back office, in German and English. Drafts: `docs/legal-drafts/legal-pages-drafts.md`. Missing: Amplivine's legal form and postal address, register entry, the small-business VAT rule (tax adviser), free or paid for now, AGB notice period and jurisdiction, the competent data protection authority, retention periods, signed processing agreements (Neon, Vercel, Resend, OpenRouter). Then a lawyer's check and the German versions. Both stores need the privacy policy address.
6. **Sign-up consent.** Build the sign-up tick "I am 18 or older and accept the terms and privacy policy" (not built yet).
7. **Ask a lawyer and a tax adviser:** keeping trader documents 6 months after account deletion (switch: `DELETE_RETENTION_MONTHS`, 0 = off); whether private persons need a trade registration (optional for now); whether the EU Digital Services Act "know your trader" duty applies to Amplivine.

**C. Store requirements (find out early, they cause the longest delays)**

8. **Developer accounts:** Apple Developer Program (bundle id `space.skillweb.app`) and Google Play Console (package `space.skillweb.app`). Registration can take days.
9. **Account deletion on the web.** Google Play requires a web address where people can request deletion of their account and data, in addition to the in-app button (which exists). Needs a small public page or form; not built.
10. **User-generated content rules.** Apple and Google expect a way to report a profile or photo, to block, and a moderation contact. Provider texts and portfolio photos count. Check the current rules and build "Report this profile" if required (not built).
11. **Store listing:** app icon, splash screen, screenshots in the required phone sizes, short and long descriptions in German and English, category, age rating, support address (info@skillweb.space), data-safety (Google) and privacy-label (Apple) answers. The placeholder graphics are still in the app: send the files or the style and the assistant prepares options.
12. **Reviewer access:** both stores need a working demo account and notes for the reviewer (one customer and one published provider on production).
13. **Production build:** `EXPO_PUBLIC_API_URL=https://skillweb.space` is already in `apps/mobile/eas.json` for the `preview` and `production` profiles. Build with EAS, install the build on a real phone, test again, then submit (Android internal test first, iOS through TestFlight).

**D. Production hardening before real users**

14. **Separate production keys** (they are shared with the test branch today): a production storage key for `kando-main` in the Neon console, and separate `RESEND_API_KEY`, `OPENROUTER_API_KEY`, `CRON_SECRET` for Production only in Vercel. **`CRON_SECRET` stays on Preview for now (owner, 29 October 2026): Preview is still needed for testing, so it cannot be removed from there yet. Remove it from Preview (untick Preview under Settings, Environment Variables, `kando-web`) when Preview testing no longer needs the cron route, or give Preview its own value.**
15. **Email:** verify the Resend sending domain for the address KANDO sends from and send a test email from production; in Neon Auth turn on custom email sending and "Require email verification" (`docs/deployment.md`).
16. **Vercel Pro** (the free plan is for non-commercial use), and check that the first daily 06:00 UTC suspension job ran.
17. **Security scan** of the whole project (row-level security, routes, Vercel settings) just before launch.
18. **Known gaps worth fixing before launch:** documents over 4.5 MB cannot be uploaded through Vercel (upload straight to storage), photos load at full size (thumbnails), and real deletion of a Neon Auth account was only tested against a stand-in.

**E. Can wait until after the first release**

19. **AI-assisted document checks** (about 90% automatic, never an automatic rejection, a person re-checks 10% and the first approvals): needs the data protection impact assessment signed (`docs/legal-drafts/dpia-ai-document-checks-draft.md`), an EU provider chosen (recommendation: Mistral; confirm data location, processing agreement, no training) and a lawyer's confirmation. Staff review documents by hand until then.
20. **Revisit the "optional for now" decisions** (the owner asked to be reminded): liability insurance, trade registration, craft qualification.
21. **Clean-up:** delete the old GitHub repository `SkillWeb`, the old Vercel project `skillweb`, the local folder `Skilled\skill-web`, and later the old Neon branch `main` (the old `dev` was deleted on 29 October 2026; `kando-main` is now the default branch, and `main` cannot be deleted while `kando-dev` is its child); then remove the "Payload" wording from this README and `docs/deployment.md`.

**F. Polish: what makes the first version feel finished (do after A to D, before submitting)**

22. **Make the home texts match the app at submission.** Owner decision, 28 October 2026: the home texts (app and website) stay as the plan for now (requests, quotes, in-app payment, "genuine reviews only after paid jobs", the "New" badge). Before the first store submission each of those promises must either be built or be changed or removed, and the store listing must say only what exists; also remove or replace the greyed "Send request" button. This depends on step 2 (what version 1 contains).
23. **German native read.** Have a German speaker read every German text (app, website, emails, back office), especially the new document names, lead texts and error messages.
24. **Look at every screen on a real phone**, in both languages, with a small and a large phone and large system text: empty states (no results, no documents), error states (airplane mode), the keyboard never hiding a field, green card contrast, loading spinners, back buttons.
25. **Real graphics:** app icon, splash screen, home page pictures and store screenshots in place of the placeholders.
26. **Speed:** photo thumbnails (the grid and the cards load full-size images), documents over 4.5 MB (upload straight to storage).
27. **Stability:** make the timing-based test `inBatches keeps the window full` (PR #14) less dependent on the clock; run the whole test suite once more before the build.
28. **Small gaps:** a bad postcode typed at sign-up is dropped silently; the share sheet shares the export as text, not as a file (needs a new app build); the unused text key `setup.documentAdd`.

**How a new session starts:** open the session in this folder, read this section, run `gh pr list`, then `git pull`. Local tests need Docker (`docker compose up -d --wait db`), see "Run it". Test reports are Excel files in `Reports/` (copy the layout of `Reports/Stage-1-Test-Report.xlsx`). The latest test report is `Reports/Stage-2b-Test-Report.xlsx`.

## Run it

Needs Node 24, pnpm 10 and Docker.

```
docker compose up -d --wait db      # Postgres 17 + PostGIS on localhost:5433
pnpm i
pnpm test                    # web (Vitest, Docker database), the app (jest), contract and texts
pnpm typecheck && pnpm lint
pnpm --filter web dev        # website on http://localhost:3000
```

Copy `.env.example` to `.env.local` and fill it in for anything that talks to Neon, storage, email or translation. `DATABASE_URL_TEST` defaults to `postgres://postgres:postgres@localhost:5433/kando`. Deployment, the environment variables, the first staff account and the cutover steps are in `docs/deployment.md`.

## Where we are (28 October 2026)

Everything below is merged into `main`; no pull request is open. The site is live at https://skillweb.space (also https://kando-web.vercel.app); Vercel project `kando-web`, root `apps/web`. **Production** runs on the Neon branch `kando-main` (empty apart from categories, postcodes and the staff you add); **Preview** and the test accounts run on `kando-dev`. Migrations 0000 to 0011 and `rls.ts` are applied on both. Automated tests on the merged state (28 October, `Reports/PRs-18-19-20-Test-Report.xlsx`): web 338 (336 passed, 1 skipped, 1 timing-based test from PR #14 failed once under load and passed alone), app 164, contract 10, i18n 15; typecheck and lint are clean.

### What was built, in order

- **Stage 1, the foundation (27 October, PR #2).** Database with row-level security, login with email and password, the email confirmed by a code (Neon Auth), the app API, photo and document storage, the translate button, document review, the staff back office under `/admin`, the public website, the phone app and the seeds. Fourteen tasks, each reviewed, plus a review of the whole branch. Payload is not part of it. Report: `Reports/Stage-1-Test-Report.xlsx`.
- **First staff account and the search list (PRs #3, #4).** Staff roles are set in the database (see `docs/deployment.md`). The Search tab now refreshes when you come back to it, so a provider suspended in the meantime disappears.
- **Back office in German and English (PR #5).** The language comes from the `admin-lang` cookie, else the browser language; a button in the header switches it. This also stopped a crash that Chrome's automatic translation caused. Report: `Reports/PR-5-Back-Office-Language-Test-Report.xlsx`.
- **Registration and one-page provider setup (PRs #6 to #8, #10).** Report: `Reports/Registration-Setup-Test-Report.xlsx`. See "How it works now".
- **Phone-test fixes (PR #11).** A postcode alone now saves as an address; a "Saved" message appears after saving in Account; "Offer services" and "Become a provider" open the profile page directly; the provider card moved under "Find help now" on Home. Report: `Reports/PR-11-Phone-Test-Fixes-Test-Report.xlsx`.

- **Review fixes and security headers (PR #14), second security fixes (PR #15).** Row-level security helper `notSuspendedSql`, security headers, a suspended person can still delete their own data, picture optional and removable, "Camera" in the picture menu, cross-site write check, daily limit on the translate button. Report: `Reports/PRs-14-15-16-Review-Fixes-Test-Report.xlsx`.
- **Delete my account and export my data (PR #16).** See "How it works now". Migrations 0009 and 0010.
- **Documents, legal and planning papers (PRs #12, #13, #17).** English legal page drafts, the data protection impact assessment draft (`docs/legal-drafts/dpia-ai-document-checks-draft.md` and `.docx`), the required documents list (`docs/required-documents-draft.md` and `.xlsx`).
- **Document requirements per category (PR #18).** Nine document types, a required and an optional list per category, editable in the back office (Categories); seeded from the owner's table. Migration 0011.
- **Checked documents on the public profile (PR #19).** "Checked documents: Photo ID, ..." on every public profile (app and website), from approved documents only (names, never files). Needs the SQL function `public_checked_documents` from `rls.ts`.
- **Profile page rework (PR #20).** Merged 28 October. Compact cards with their own edit screens, stars and lead texts, card colours, new compulsory fields. See "How it works now".
- **Stage 2a, requests, quotes and bookings without money (29 October, branch `stage-2a-bookings`, merged as pull request #25).** Ten tasks, each reviewed: tables and security rules (migrations 0012 to 0014), contract, rules, requests and quotes, direct booking with the date-and-time proposal (answer, counter, withdraw), busy times, timers, notifications and emails, and the phone screens. Tests on the branch (29 October): web 414 (53 files), app 182 (37 suites), contract 17, i18n 15, domain 14, all passed; typecheck shows only the 4 older typed-route errors in `apps/mobile` (about-card, documents-card, services-card x2); lint reports only the 38 older errors in scratch and marketing scripts. Report: `Reports/Stage-2a-Test-Report.xlsx`. Migrations 0012 to 0014 are applied to production `kando-main` (29 October 2026); 0015 and 0016 (Stage 2b) are applied before the 2b merge. The booking timer runs daily until Vercel Pro (see "In the background"). Nothing from Stage 2a has been seen on a phone yet.

- **Stage 2b, chat and contact-detail blocking (29 October, branch `stage-2b-chat`, built and reviewed; merge pending).** Eight tasks, each reviewed: chat tables and security (migrations 0015 and 0016), the contact-detail check, threads, messages, photos and cards, report, block and the new-message notice, the phone chat, staff flags and thread access with a log, request limits and the export. Tests on the branch (29 October): web 471 (59 files), app 204 (40 suites), contract 18, i18n 15, domain 127, all passed; typecheck shows only the 4 older typed-route errors in `apps/mobile`; lint reports only the 38 older errors in scratch and marketing scripts. Report: `Reports/Stage-2b-Test-Report.xlsx`. **Before this branch is merged and deployed:** the production database needs migrations 0015 and 0016 (`pnpm db:migrate` against `kando-main`, only on the owner's instruction). Nothing from Stage 2b has been seen on a phone or in a browser yet.

**Before 2b (payments), from the final Stage 2a review:**
- Account deletion removes the other party's requests, quotes and bookings; that must not survive once money exists.
- A quote's customer can update quote columns, and booking `quote_id` / `service_id` are not checked by the security rules: make money and status columns staff-only or written by a definer function when payments land.
- Add `accepted_at` before payment code writes to awaiting-payment rows.
- At most one open request per customer-provider pair plus a small daily cap (abuse of the requests-ignored notice and inbox flooding).
- The data export must include requests, quotes and bookings.
- A declined or lapsed quote-born booking leaves the request closed (owner decision: reopen the request or the quote).
- `withdrawBooking` and slot-freed notices.
- `customerId` is exposed to providers in the booking DTOs.
- Payment code in 2b must refuse payment when `pay_by <= now` (a lapsed hold stays `awaiting-payment` until a sweep, so two overlapping awaiting-payment rows can exist for a moment), and `pay_by` has no CHECK (an awaiting-payment row with null `pay_by` never holds a slot and never expires): add a constraint in the 2b migration.

**Before 2c (payments), from Stage 2b:**
- Messages are deleted with the account, including the other party's: the owner decides retention versus erasure of dispute evidence before money exists.
- Add `requestId` to the Booking DTO (finding the chat of a booking costs one query per booking today).
- `staff_access_log` has no append-only trigger (append-only by use only).
- A resolved contact-attempts flag is raised again at once by the very next blocked attempt within 24 hours, because the older attempts still count.
- No backfill of chat threads for requests and bookings made before migration 0015 (production is empty, so none is needed).
- Polling costs about 900 calls per hour per open chat (4-second interval): watch Vercel and Neon usage.
- Staff may read a thread forever once any report exists on it.

### How it works now

- **Sign-up** asks for first name, surname, email, password, an optional picture (with the reason: providers see who they work for, which is safer), an optional address and one tick, "I also want to offer services". Only the postcode of the address is required if you give one; street and city are optional and stay private. The answers are kept on the phone until the email code is confirmed, and only ever applied to the account they were made for.
- **My service profile.** Opening it creates an empty draft; every field saves as you type. The page holds compact cards that work like Past jobs and Portfolio (card name, add or edit button, short rows, editing on its own screen): Services (category compulsory, price type and price), About you, Past jobs, Portfolio and Verification documents. A card with all its compulsory information is green with green text; a card lacking something stays white. **Compulsory fields** carry a "*" and a short lead text: a service with a price type; in About you provider type, at least one strength, at least one skill, postcode and service radius (default 25 km); a business also needs a business name and a legal notice. Experience is optional. The **Publish** button is grey (no list of what is missing) until the profile is complete; a live profile cannot be edited into an incomplete state. Skills and strengths are typed in a narrow field with a "+" button; at 20 entries the "+" disappears and a note says the maximum is reached.
- **Documents.** Each category has required documents (to go live) and optional ones (a slot; an approved optional document shows as a badge). Photo ID is the only document every category requires; catering adds hygiene certificate and food business registration, dog walking the permit, babysitting the police certificate; trade registration, liability insurance, craft qualification and the others are optional for now (table: `docs/required-documents-draft.xlsx`, live values in the back office under Categories). In the app only compulsory documents are mentioned under the category selection; the Verification documents card lists all of them: a compulsory document that is not approved is red, an optional one orange, an approved one green. A faulty document is replaced by adding the new one first and then deleting the old one. Staff approve or reject by hand.
- **Public profile.** Shows the services, past jobs, portfolio and one line "Checked documents: Photo ID, Liability insurance" (names of approved documents only).
- **After Publish** the provider sees "Your profile is live. Tell people about it." with a Share button. If a document check is still pending, the message says the service goes live after the check and there is no Share button.
- **The My profile tab is for providers only.** A customer opens the same page through Account, Offer services (or the card on Home), which creates the draft, makes them a provider and then shows the tab.
- **Emails say what really happened:** document approved (profile live, service visible, profile offline, profile suspended), document rejected with the staff note, profile suspended with reason and end date, profile published again. When the last pending document is approved there is also a banner with Share and a dot on the Account tab.
- **Suspensions end by their date.** A daily check at 06:00 UTC (`/api/cron/suspensions`, protected by `CRON_SECRET`) ends the ones whose date has passed; staff can lift earlier. Emails only go to people whose profile was live.
- **Export and delete (Account tab, below Log out).** "Export as JSON" and "Export as CSV" fetch the person's own data (profile, services, references, photo links, documents and files with 5-minute signed links, notifications, and a list of what is not included) and open the phone's share sheet with the text (`GET /app-api/v1/me/export`, `?format=csv` for the CSV: columns section, record, field, value, UTF-8 with a byte order mark; an unknown format is 400 BAD_FORMAT). The app shares the text, not a file, because expo-sharing is not installed. "Delete my account" asks the person to type their own email, then deletes everything at once and for good, in one database transaction: notifications, documents, uploaded files, photos, the provider profile with services and references (the client names go with it), the person, their translation rate-limit rows and their Neon Auth records. The files to remove are written to a table `pending_object_deletes` in the same transaction; after the commit they are deleted and the rows cleared, and the daily check retries what is left (a failure is only logged with a count and never fails the request). A reviewer's id is cleared from the documents they reviewed. Neon Auth records are found through their foreign keys to the user, and pending email codes (`<type>-otp-<email>`) go too. After the deletion the old session cookie gets 401 (no users row is recreated). A provider's (or a document-submitter's) basic trader details and the metadata of their submitted documents are kept in `retained_records` for 6 months because of a legal duty, and the document files stay in storage that long; the daily check then deletes them (`DELETE_RETENTION_MONTHS`, 0 switches it off; the rule is under legal review). A provider can delete a submitted document once another one for the same requirement exists (`DELETE /app-api/v1/verifications/:id`, else 409 REPLACEMENT_FIRST). Then a confirmation email goes to the old address in the saved language. The only remaining Administrator gets "409 LAST_ADMIN" until another exists. The shared translations cache is not touched (a separate clean-up job comes later). Routes: `GET /app-api/v1/me/export`, `DELETE /app-api/v1/me`. Error texts in the app say what went wrong, the likely cause and what to do next.
- The public name is first name plus the first letter of the surname (or the business name) and follows a rename.

### Phone testing

The app is the development build "SkillWeb (Development Build)" installed from the EAS build page (Expo project `b66a6d0d-2214-47e3-85be-cd5501e24f6c`, owner `liezljvv74`). It talks to the server named in `EXPO_PUBLIC_API_URL`. To test against production (https://skillweb.space; note that this is the real `kando-main` database, so sign up with your own email):

```
cd apps/mobile
# .env holds EXPO_PUBLIC_API_URL=https://skillweb.space (git-ignored; copy .env.example)
npx expo start --dev-client --tunnel
```

Scan the QR code with the development app's own "Scan QR Code" button, or type the printed address under "Enter URL manually". The address must start with `https://` (turn `exp+skilled://host` into `https://host`; the camera app cannot open it). The tunnel only lives while the server runs. A different server address must first be added to Neon Auth with `neon neon-auth domain add <address> --project-id withered-wave-83432300 --branch <branch>`. To test without touching production, point the app at a Preview deployment (uses `kando-dev`). Stop the server when you are done; when the computer is short of memory Claude Code stops it by itself.

### Test accounts (dev branch only)

`pnpm db:seed:test-users` creates customers and published providers from `packages/domain/seed-data/test-users.json`. Each person has `firstName` and `lastName` and an optional address; the public name is built from the names. That file is not in git (the repository is public) and lives on this PC only; a fresh clone starts from `test-users.example.json` (copy it to `test-users.json`). The password is in the file; emails are created verified. Seeds refuse to run anywhere but the dev branch. `kunde.berlin@example.com` is an Administrator on `kando-dev` for the back office.

## Outstanding

### Reminder: revisit before launch

- **Liability insurance is optional for now** in every category (decision of 28 October 2026), so private persons are not blocked. Decide before launch whether it becomes required again for cleaning, gardening, moving, assembly, small repairs, catering and dog walking. The same goes for the trade registration (optional for now) and the craft qualification (optional for Small repairs). Change it in the back office (Categories) or in `packages/db/src/seed/categories.ts`.

### Tests that must still be done

Nothing has been checked on a phone or in a real browser yet; every "Not yet done" row in the reports' Other Checks sheets is on this list.

0. **Stage 2b on two accounts (phone and browser):** send text and a photo in a chat; a phone number in digits and in words is refused with the right German and English text; report a message; block and unblock; a request with photos; the new-message email once per 30 minutes; the notification Open button and deep link; scrolling and keyboard; a chat of more than 100 messages; the back-office Flags and thread pages as Reviewer and as Administrator. The list is in `Reports/Stage-2b-Test-Report.xlsx` (Other Checks).
0. **Stage 2a on two accounts (a customer and a published provider on `kando-dev`):** the customer asks for a quote; the provider sends a quote and revises it; the customer accepts and proposes a time; the provider accepts, counters and declines (try each); the customer withdraws ("I no longer need this"); a direct booking of a fixed-price service; busy times shown; the 7-day quote expiry text; German and English; error messages (airplane mode, slot taken, expired quote); the confirmation dialogs; the booking emails arrive; the daily `/api/cron/bookings` run is visible under Cron Jobs in Vercel. The full list is in `Reports/Stage-2a-Test-Report.xlsx` (Other Checks).
1. **Customer sign-up** with your own email: names, picture, postcode only; confirm the code; Home shows no My profile tab; the picture nudge disappears once a picture is added.
2. **Account, Offer services** (and Home, Become a provider) opens the profile page directly, the tab then appears. Airplane mode: an error shows and you stay put. A second tap does nothing.
3. **Sign-up with the provider tick** lands on "Let's set up your service profile"; nothing from a previous account carries over after sign-out and sign-in as someone else.
4. **The profile page:** fill it, close the app halfway and reopen (typing must be there), add a second service, check the keyboard never hides a field, upload a document by file, gallery and camera; Publish is grey (no list) until complete; compulsory fields have a star and a lead text; cards turn green when complete; documents: compulsory red, optional orange; the skills and strengths "+" and the limit note.
5. **Publish and Share:** the Share sheet opens; with a pending document check there is no Share button.
6. **Back office in a browser** (https://skillweb.space/admin): approve and reject a document (emails, banner, dot), suspend and lift a user (emails, search, public page), categories, pages (publish an Impressum and see it on the site), staff roles, the language switch, no crash page.
7. **Account tab:** a postcode alone saves, "Saved" appears and goes, a badly formed postcode shows its message, fields lock while saving.
8. **Older checks never done on a phone with this app:** password reset by code, a wrong sign-up code, the translate button, Live switch off and on, profile and portfolio photos, the 7-day session (open the app a day later and still be signed in), the daily suspension check at 06:00 UTC (first run), email delivery from Resend.
9. **New since the last list:** a public profile shows "Checked documents" only for approved documents (approve, reject, check); delete my account on a throw-away account on `kando-dev` (then check the Neon Auth tables and both storage buckets); export as JSON and CSV opens the share sheet and the CSV opens in a spreadsheet; suspended person deleting a document or photo; security headers live; the first 06:00 UTC suspension run.
10. **Security scan** of the whole project (row-level security, routes, Vercel settings) before launch.

### Small points parked from the reviews

- A bad postcode typed at sign-up is dropped silently (the error shows in Account).
- The "not suspended" rule in JavaScript still exists as copies that compare with the app server's clock (`providers/items.ts` withState, `providers/profile.ts` publish, `notifications.ts`); the SQL copies now all use the shared `notSuspended` helper.
- Email dates use one time zone constant (`TIME_ZONE`, Europe/Berlin, in `packages/i18n`); it has to become per country before South Africa.
- Details: the Open Items sheets of the reports in `Reports/`.

### Retiring the old Payload stack

KANDO contains no Payload code. The owner decided on 28 October 2026 to delete the old project completely; there are no live users and production held only test data. Status:

1. Production data was not moved. **Done.**
2. Production Neon branch `kando-main`. **Done.**
3. Production settings in Vercel for `kando-web`. **Done** (see below).
4. Host the new site on skillweb.space. **Done on 28 October:** `skillweb.space` and `www.skillweb.space` were removed from the old project `skillweb` and added to `kando-web`; `NEXT_PUBLIC_SERVER_URL=https://skillweb.space`; Production redeployed. Neon Auth trusts both addresses.
5. Still to do, owner: delete the old GitHub repository `SkillWeb` (its open pull request #16 is the design document, already in `docs/specs/`; GitHub restores a deleted repository for 90 days), delete the old Vercel project `skillweb`, delete the local folder `Skilled\skill-web` (its `.env` files hold the old keys and exist only on that PC: copy them elsewhere first if a backup is wanted; the `Marketing/` folder named in older notes no longer exists), and decide how long to keep the old Neon branches `main` and `dev` before deleting them.
6. Then remove the "Payload" wording from this README and from `docs/deployment.md`.

### Where things are on the owner's PC

Today the project folder is `C:\Users\Liezl\Documents\APPS FOR BUSINESS\Skilled\KANDO`; the owner plans to move it to `C:\Users\Liezl\Documents\APPS FOR BUSINESS\KANDO` (update this line after the move). Earlier working copies in `...\Skilled\` (`KANDO-del`, `KANDO-docs`, `KANDO-req`, `KANDO-sf2`, `KANDO-int`, `KANDO-ui`, `KANDO-pub`) are git worktrees of this project or throw-away copies; after the move run `git worktree repair <path>` for any you still need, or delete them (`git worktree remove --force <path>`; every branch worth keeping is on GitHub). Local test databases in Docker (`kando-db-1`, port 5433): `kando`, `kando_sf2`, `kando_req`, `kando_pub`, `kando_ui`, `kando_int`, `kando_fin` (two test runs at once on one database break each other). A notes file `.work/HANDOFF.md` and report scripts `.work/scripts/` exist only on this PC (git-ignored).

### Cutover progress (28 October 2026)

**Done**

- Neon branch `kando-main` (endpoint `ep-empty-sound-b948a10w`) was created as a copy of `kando-dev` and emptied of all users and data; it holds the 14 categories (with the document lists), the 10,815 postcodes, Germany and the euro. Migrations 0000 to 0011 and `rls.ts` are applied on `kando-main` and `kando-dev`.
- Neon Auth on `kando-main` has its own address; `https://skillweb.space` and `https://kando-web.vercel.app` are trusted on both branches. Storage buckets `media` and `documents` exist.
- Vercel `kando-web`: **Production** uses `kando-main`; **Preview** uses `kando-dev`. Variables are in place for both (database, Neon Auth, storage keys and buckets, `RESEND_API_KEY`, `OPENROUTER_API_KEY`, `TRANSLATE_MODEL`, `CRON_SECRET`); the secret values cannot be read back. The domain was moved and Production redeployed (see above).

**Not done yet:** see "START HERE" (sections A to D). In short: first administrator, phone test, legal pages, store requirements, separate production keys, email setup, Vercel Pro, security scan.

**Decisions made on 28 October 2026 (owner)**

- Documents: see "How it works now". Photo ID for everyone; trade registration, liability insurance and craft qualification optional for now (revisit before launch); police certificate required for babysitting, optional for cleaning and dog walking; documents are kept while the account exists and 6 months after deletion (legal review pending; `DELETE_RETENTION_MONTHS`, 0 switches it off); a faulty document is replaced by adding the new one first.
- AI document checks: about 90% decided by the AI, never an automatic rejection, a person re-checks about 10% of automatic approvals, a provider's first approvals are checked by a person. The data protection impact assessment draft records this. Provider and region: all of the EU, provider not chosen (recommendation Mistral). Not built; blocked on sign-off, provider contract and a lawyer.
- Legal pages: company Amplivine, email info@skillweb.space, person responsible Liezl Fourie, no VAT number; drafts in English, German after approval.

### Next features

Stage 2 of the design: requests, quotes, direct booking, payments with Stripe Connect, ratings, chat, push notifications. Each starts with a design conversation.

**Stage 2 design in progress (29 October 2026).** Agreed so far with the owner: the customer asks for a quote, the provider quotes, they may negotiate, the customer accepts, date, time and duration are agreed, the customer pays the full amount up front and it is held until the work is done, both sides review each other (written blind, shown together), the provider is paid if there is no dispute. **Deposits come after the first version.** The payment side is built behind an off switch: real payments stay off until the lawyer has cleared the legal points below. **To do: choose an EU AI provider and sign a data processing agreement for the chat contact-detail check (the same choice as for the document checks, step 19); until then the chat check uses rules only (including numbers written in words).** The customer has 7 days after the provider marks a job finished to confirm or dispute (reminders after 1, 3 and 6 days); after that Stripe releases the payment and the commission goes to KANDO. Contact details are never shared in the chat. **To decide: the commission percentage, before payouts or the Preise page are built.** Design: `docs/superpowers/specs/2026-10-29-stage-2-booking-and-money-design.md`. An extra task during a job reuses the quote and accept flow as an "Additional task" linked to the booking, started only once accepted and paid. Quotes expire after 7 days, shown clearly to the customer.

### Stage 2 build progress (updated after every stage: read this first to resume)

Stage 2 is built as five plans in `docs/superpowers/plans/` (one file each, `2026-10-29-stage-2a` to `2e`) from the design above, by subagent-driven execution: every task is built by a fresh helper and independently reviewed, each stage ends with a whole-branch code review and one fix round, then the owner-approved merge (the owner allowed Claude to merge each stage and to apply database migrations directly to production `kando-main`, 29 October 2026; nobody uses production yet). Real payments stay off (code switch) until the legal points below are cleared. At the very end one combined code review report for all the stage pull requests goes in `Reports/`.

| Stage | What | Status |
|---|---|---|
| 2a | Requests, quotes and bookings, no money (plan `2026-10-29-stage-2a-requests-quotes-bookings.md`) | **Done: merged as pull request #25 (29 October 2026).** Branch `stage-2a-bookings`, test report `Reports/Stage-2a-Test-Report.xlsx`; whole-branch review and one fix round done; not yet tried on a phone |
| 2b | Chat, contact-detail blocking, photos on requests, report and block, staff access | **Done: merged as pull request #27 (29 October 2026).** Branch `stage-2b-chat`, test report `Reports/Stage-2b-Test-Report.xlsx`; whole-branch review and one fix round done; not yet tried on a phone or in a browser |
| 2c | Payments behind the off switch (Stripe test keys; Stripe holds the money; payout set-up, verified mark, notify me) | **Done: merged into `release/phase-2` as pull request #28 (30 October 2026); NOT in production yet.** Branch `stage-2c-payments`, test report `Reports/Stage-2c-Test-Report.xlsx`; whole-branch review and one fix round done; not yet tried on a phone; the real Stripe account still needs Accounts v2 enabled (rerun `pnpm payments:smoke`) |
| 2d | Finishing, 7-day confirmation, disputes, cancellation, "Stop job", additional tasks, reviews, back-office screens | Not started |
| 2e | Push notifications, invoices, final README and test report | Not started |

**To resume after an interruption:** (1) `git log --oneline -15` and `gh pr list --state all --limit 10` to see which stage branch and pull request exist and whether they are merged; (2) read the matching plan file, then the "Before 2b" list under "Stage 2a" in "What was built"; (3) a local build ledger with every ruling and deferred point may exist at `.superpowers/sdd/<plan name>/progress.md` (git-ignored, PC only); the summary of rulings is also in the stage's test report (`Open Items` sheet); (4) the next stage starts from an up-to-date `main` on a new branch `stage-2b-chat` and so on; (5) after each stage: update this table and the "What the app does today" section, add the stage's test report, apply new migrations to production `kando-main` before merging, merge, check the deploy on https://skillweb.space.

**Release flow for Phase 2:** nothing is merged into `main` until 2c, 2d and 2e are all done, tested and fixed. Pull requests of the stages target the branch `release/phase-2` (stage branches get no Vercel deployments: `git.deploymentEnabled` in `apps/web/vercel.json`; `main` is protected: pull request and the checks `check` and `mobile`). Staging is the preview of the `release/phase-2` branch on the dev database `kando-dev`. The single production deployment happens when `release/phase-2` is merged into `main`; migrations 0017 and later are applied to production `kando-main` first.

**Production database:** migrations 0000 to 0016 are applied to `kando-main` (stage 2a's 0012 to 0014 and stage 2b's 0015 and 0016 on 29 October 2026, checked: chat tables with row-level security, `is_blocked`, `staff_access_log`, 17 migrations, the app role can only read and add messages). Next stage: apply its new migrations to `kando-main` with `pnpm db:migrate` (owner connection, unpooled string) BEFORE merging.

### Stripe test-mode set-up (owner)

Needed before payments can be tried; the code does nothing with Stripe while `PAYMENTS_ENABLED` is not `true`. Test mode only (the code refuses live keys).

1. In the Stripe Dashboard use a **sandbox** account. Turn on **Connect** as a marketplace platform in Germany and accept that the platform carries the loss liability. Turn on **Accounts v2** (`pnpm payments:smoke` showed it was off for the owner's sandbox on 30 October 2026); connected accounts are v2 recipient accounts.
2. Set the platform's own **payouts to manual** (Settings, Payouts), so that the held money is not paid to KANDO's bank. The commission is paid out by hand within 90 days.
3. Switch **delayed payment methods (for example SEPA debit) off** in the payment methods settings.
4. Create two webhook endpoints, both with the URL `https://<the site>/api/stripe/webhook` and both pinned to the API version `2026-09-30.endive`:
   - Receiving events from **"Your account"**: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.dispute.created`, `refund.failed` (optional: `charge.refund.updated`). Its signing secret is `STRIPE_WEBHOOK_SECRET`.
   - Receiving events from **"Connected accounts"**: `account.updated`. Its signing secret is `STRIPE_CONNECT_WEBHOOK_SECRET`.
5. Create a **restricted test key** (`rk_test_...`) or use the secret test key. Permissions: write for Checkout Sessions, Transfers, Refunds, Connect v2 accounts, account links and Balance Settings; read for PaymentIntents.
6. Environment variables (Vercel Preview of `release/phase-2`; locally in `.env`): `PAYMENTS_ENABLED=true`, `STRIPE_SECRET_KEY` (the local `.env` may spell it `Stripe_Secret_Key`; Vercel needs the upper-case name), `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`, `NEXT_PUBLIC_SERVER_URL` (the site URL, used for Stripe's return links). Never paste a key into a chat, a commit or a report.
7. Vercel **Deployment Protection** blocks Stripe's calls to preview URLs: let the path `/api/stripe/webhook` through (protection bypass).
8. Run `pnpm payments:smoke` (the test key must be in `.env`): it creates a test account, an onboarding link and an unpaid Checkout session of 12.34 EUR and prints PASS, FAIL or SKIPPED per step. No money moves; transfers and refunds are not tried.
9. Rules of operation: never switch `PAYMENTS_ENABLED` off within 24 hours of the last pay link (an open session could still be paid); resend a failed webhook event from the Dashboard within 3 days (Stripe stops retrying after that); a payment that could not be processed raises a staff flag.
    - If the webhook endpoint is unreachable for more than 10 minutes (Deployment Protection set wrongly, an outage), a payment made just before the pay-by time can be refunded and the booking expires, because the app judges lateness by processing time, not by the time of payment. After any such period check the Stripe Dashboard (Developers, Webhooks) for failed deliveries and resend them.
    - Open Stripe findings to check after turning on Accounts v2: `accountReady` may not see the payouts capability on recipient accounts; `account.updated` for v2 accounts may need a different event (v2 accounts may send their own event types); rerun `pnpm payments:smoke` and look at the result of each step.
10. Run `pnpm install` once: `node_modules` still records the old `Skilled` folder, so `pnpm add` needed a workaround when Stripe was added.

**Decide the commission percentage: `COMMISSION_RATE` is a placeholder (12%).**

**Stage 2c on a phone (after the set-up and migration 0017 on `kando-dev`):** Pay now with the Stripe test card 4242 4242 4242 4242 on iOS and Android (the booking turns Confirmed); the declined card 4000 0000 0000 0002; the 3-D Secure card 4000 0027 6000 3184; close the Stripe page before paying (the "being confirmed" state, Refresh, Pay again); a booking after its pay-by time; the provider payout set-up flow and the verified mark; the notify me toggle and both notices; German and English texts. The list is in `Reports/Stage-2c-Test-Report.xlsx` (Other Checks).

### Legal points to clear with a lawyer (before payments are built or promised in any text)

These are questions to ask, not answers. Do not publish any of the related texts before they are settled.

1. **Holding the customer's money until the job is done.** Is the planned Stripe Connect set-up (the customer pays up front, the money is held, then paid out) allowed without KANDO needing its own payment licence? Which wording is safe? The foundation design bans "Treuhand", "Escrow" and "Garantie" in product and marketing texts.
2. **Right of withdrawal (14 days) against cancellation fees.** German consumers often may withdraw from services bought at a distance. Does that limit a late-cancellation fee, and what must the customer acknowledge and consent to when the work starts within the withdrawal period?
3. **Cancellation terms.** Are free cancellation up to 24 hours before, about half the price after that, and the full price for a no-show valid in the terms (AGB) for private customers, in particular for babysitting and dog walking?
4. **Staff dispute decisions.** May KANDO staff decide a dispute (full refund, partial refund, full payout), is that decision binding on the parties, and what must the terms and the site say about out-of-court dispute resolution for consumers?
5. **Reviews.** What must the site say about whether and how reviews are checked to come from people who really booked (EU rules on consumer reviews), and what may staff hide or remove?


## Known gaps

- No thumbnail sizes: the photo grid and the cards load full-size images.
- Documents over 4.5 MB cannot be uploaded through Vercel; the fix is to upload straight from the phone to storage.
- Delete my account removes Neon Auth records through their foreign keys to the user; it has only been tested against a stand-in schema, not against the real Neon Auth tables.
- Placeholder graphics (app icon, splash, home page pictures) are still to be replaced.
- The legal pages are records that staff must write and publish in the back office.
- Push notifications come with bookings; until then the banner and the email are the only signals.
- Before South Africa (not needed for Germany): the website footer links to the German legal pages directly, the website and back office language switches assume exactly two languages, and a country missing from the countries table makes its addresses fail the postcode check.
