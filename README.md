# KANDO: SkillWeb

A service marketplace for Germany. Households find, request and book trusted, document-checked local helpers and small businesses; the customer pays through Stripe, the money is released when the job is done, and the paperwork (invoices, receipts) is included. Live at https://skillweb.space (project `kando-web` on Vercel). **State on 2 November 2026: the booking flow is built (server and phone app); "Flow 1", the one path from request to booked job with a quote document, is finished in code but has not yet been walked through on a phone; payments run in Stripe TEST mode only; the app is not in the app stores; no real customer or provider uses it yet.**

- **Design papers:** `docs/specs/2026-10-26-kando-foundation-design.md` (what release 1 does, the stack, the rules), `docs/specs/2026-10-27-registration-and-provider-setup-design.md`, `docs/superpowers/specs/2026-10-29-stage-2-booking-and-money-design.md` (booking and money), `docs/superpowers/specs/2026-10-30-assessment-findings.md` (the 33 assessment findings). Plans are in `docs/plans/` and `docs/superpowers/plans/`.
- **Stack:** Expo phone app (`apps/mobile`, SDK 58, expo-router); Next.js 16 on Vercel for the public website, the staff back office (Refine, German and English) and the API (`apps/web`); Neon Postgres with PostGIS and row-level security; Neon Auth (Better Auth) for login; Neon Object Storage for photos and documents; Drizzle (`packages/db`); business rules (`packages/domain`); shared input rules and constants (`packages/contract`, zod); one text catalogue in German and English (`packages/i18n`); Stripe Connect (test mode); Resend for email; Expo push; OpenRouter for the translate button.
- **Rules for this project:** every change goes through a pull request; the owner merges (exception: during a fix batch the owner may authorise merging stage pull requests into a release branch and one final merge to `main`); a test report in `Reports/` after every stage; no competitor names anywhere; no AI co-author or "Generated with" lines in commits or pull requests; every user-facing text exists in German and English; South Africa follows later, so no new Germany-only assumptions (country and currency come from the country record).

Layout: `apps/mobile`, `apps/web`, `packages/{db,domain,contract,i18n}`, `Reports/`, `docs/`.

## What the app looks like and what it does

### The phone app (German and English)

Four tabs at the bottom: **Home**, **Search**, **My profile** (only for providers) and **Account** (a dot shows an unseen notice). Booking lists, request screens, chats and invoices open from Home and from notices.

- **Sign-up and login:** first name, surname, email, password (8 or more characters), optional picture, optional address (only the postcode is required if you give one) and a switch "I also want to offer services". The email is confirmed with a code; password reset by code; the session lasts 7 days. There is no age or terms tick yet. A busy login server shows "busy, try again" with a Retry button, never a sign-out.
- **Home:** headline, "Find help now", a category list that opens a search, notices (each booking notice has an Open button), "My bookings", a picture reminder, a "Become a provider" card.
- **Search:** category, 5-digit postcode, free text. Lists published, not suspended providers with at least one service whose required documents are approved, nearest first when a postcode is given (a provider only shows inside their own service radius; remote providers always show); 20 per page; ratings on the cards.
- **Public provider page:** picture, public name (first name plus the first letter of the surname, or the business name), place, categories, "Checked documents: ..." (approved document names only), a translate button (OpenRouter, limited per person and per day), strengths, skills, experience, services with prices (fixed, per hour, from, on request), past jobs, portfolio photos, and the legal notice for businesses. From here a customer **requests a quote** (any service) or taps **Book** (fixed-price services); both open the same request form, with the service already chosen.
- **My profile (providers):** cards that open their own edit screens: Services, About you, Past jobs (at most 2), Portfolio (at most 12 photos) and Verification documents; autosave; Publish and Unpublish. A card with everything it needs turns green; Publish stays grey until the profile is complete. Compulsory fields carry a "*": per service a category and price type; in About you provider type, at least one strength and one skill, postcode and service radius (default 25 km); a business also needs a business name and a legal notice. Skills and strengths stop at 20 entries.
- **Requests, quotes, bookings (Flow 1):** one path for every new job.
  1. **Request:** the customer fills in one form: what is needed, date, time, duration, on site or remote, address (prefilled from the saved address), a note and photos, with native date and time pickers. A date and time are required.
  2. **Provider answer:** the provider sends a quote (amount, scope; revisable; valid 7 days) or declines. The amount starts with the service's fixed price when there is one. A switch "date and time confirmed" (on only while the customer's time is still ahead) says whether the provider agrees to the requested time; the provider can leave it off.
  3. **Customer:** reads the quote, taps **Confirm** (the booking is created) or **Decline**. Decline first offers to talk in the chat, with "Decline anyway" as the button that really declines. Once a quote exists the request cannot be edited; changes are discussed in the chat. The customer can withdraw.
  4. **Booking:** a quote confirmed with a time becomes a booking that waits for payment. A quote without a confirmed time becomes a booking in status "awaiting time": either side enters a time, the other side confirms it (2 days to answer), and the booking then waits for payment. If no time is agreed within 7 days the booking lapses. The app shows "date and time to be confirmed" and the pending time, never the stand-in time (see Known gaps).
  5. **Quote documents:** every quote has a document with a number (`Q-XXXXXXXX-YYYY-0001`) and a PDF. The Account tab has "Quotes sent" and "My received quotes"; a row opens the PDF or the request.
  Busy times are respected (first come, first served, with a travel buffer on site). Lists load 50 at a time with "Show more". One open request per customer and provider; at most 10 requests per customer per day. A new job only starts as a request: `POST /bookings` and the direct-booking domain function are gone. The old paths (a customer proposing a time after a quote, the provider accepting or countering a proposed time, the "talk first" rounds) are removed (step 1.6b, part 1): `/quotes/[id]/accept` now serves additional tasks only (an ordinary quote is confirmed, 409 `use-confirm`), and the `answer` route is gone. The status `proposed` is gone too (step 1.6b, part 2, migration 0028): a booking starts as `awaiting-time` or `awaiting-payment`, only the server creates it, and the app role inserts no booking at all.
- **Paying (when payments are on):** the customer pays an accepted booking on Stripe's hosted page (the full amount); the booking becomes **Confirmed** when Stripe tells the server. Providers set up payouts through a Stripe-hosted form and get a verified mark; a customer cannot book a provider who is not ready, but can tap **notify me**. A booking more than 60 days ahead cannot be paid. The pay card knows from the start whether payments are on.
- **Finishing, cancelling, disputes, reviews:** the provider taps Finished; the customer has 7 days to confirm (reminders after 1, 3, 6 days); on confirmation or after 7 days of silence the money is released (commission kept). Cancelling a confirmed booking is free more than 24 hours before the start and costs 50 percent after that; a no-show can be reported and the other side has 48 hours to object. After Finished or Stop either side can open a dispute; staff decide (full payout, partial amount or full refund, always with a written reason, within 14 working days). **Stop job** ends a started job at an agreed amount (the other side answers within 7 days). An **additional task** is a linked booking with its own payment. After a completed job both sides can write a review (1 to 5 stars, hidden until both are in or 7 days have passed).
- **Chat:** one chat per request and booking, text (at most 2000 characters) and photos, quote and acceptance cards posted by the system; the app polls every 4 seconds (no live push). Phone numbers, emails and links are refused (also written in words); three blocked attempts in 24 hours flag the sender to staff; either person can report a message or block the other; at most 30 messages per 10 minutes. The same refusal applies to profile, service, past-job and name texts.
- **Notices, push and email:** 40 notice kinds; each goes by push if the phone has a token and the switch allows it, otherwise by email in the saved language. Push switches per kind are on the Account tab.
- **Invoices:** invoices and receipts in the provider's name with their own numbering (PDF), a yearly CSV export, and monthly commission invoices from the platform to the provider.
- **Account:** edit name and address, "Offer services", push switches, export my data (JSON or CSV), delete my account (asks for the password; a wrong password deletes nothing), log out, link to the back office for staff. A failed load shows Retry.

### The website (German and English with `?lang=`)

Home page, public provider pages, sitemaps and the legal and information pages that staff publish in the back office, with a footer linking to them. Public pages are cached per language and refreshed when content changes. The App Store and Google Play buttons say "soon".

### The back office `/admin` (German and English; staff only)

Roles: **administrator** (everything) and **reviewer** (reads and reviews, cannot see providers' payment or tax data). Screens: Dashboard, Documents (approve or reject with a note, which emails the person), Users (suspend with reason and end date, lift), Providers, Categories (names, required and optional documents, sort order), Pages (Markdown, German and English), Staff (roles), Flags (contact-detail attempts and reported messages; opening a reported chat is logged), Bookings, money state, Disputes (decide with a written reason), Refunds, Reviews.

### Background jobs (Vercel cron, all protected by `CRON_SECRET`)

| Time (UTC) | Route | What |
|---|---|---|
| 03:00 | `/api/cron/bookings` | expires requests, quotes and bookings; quote and payment reminders; requests-ignored notice |
| 04:00 | `/api/cron/money` | stood no-shows, automatic releases, cancelled bookings to settle |
| 05:00 | `/api/cron/invoices` | invoices, receipts, monthly commission invoices |
| 06:00 | `/api/cron/suspensions` | ends suspensions, trader records after 6 months, failed file deletions, clean-up (notices 180 days, Stripe events 90 days, device tokens 270 days, blocked contact text 90 days) |

Emails and pushes of timer notices go through an outbox (`notifications.mailed_at`); a notice not emailed within 48 hours is not emailed late. A lapsed item shows as expired at once; only its notice waits for the cron run. Daily is the free-plan limit; with Vercel Pro the booking route should run hourly (`apps/web/vercel.json`), otherwise short payment windows get no reminder.

## How it works (for the next developer)

- **Two database pools** (`packages/db/src/client.ts`): requests run as role `app_user` under row-level security (`appPool`); the migration, cron and settlement work uses the owner pool. `rls.ts` holds every policy, trigger and definer function and is re-applied atomically on every `pnpm db:migrate`. Booking and request status moves are guarded by a trigger (`APP_STATUS_MOVES`, only the answering side accepts or declines).
- **Request handling** (`packages/domain/src/app-request.ts`): one shared guard for session, origin (a cookie write without Origin is refused), body size (uploads need Content-Length, else 411; 25 megapixel cap), row-level-security transaction and `Cache-Control: private, no-store`. Work that calls Stripe, storage or AI, and all emails and pushes, run after the response or after the transaction (`AfterTransaction`); settlements call Stripe inside a short owner-pool transaction under the booking lock.
- **Money:** Stripe holds the money (separate charges and transfers); the commission is fixed per booking when paid; the ledger of money movements is append-only; payments exist only behind `PAYMENTS_ENABLED=true` and only test keys are accepted (`LIVE_PAYMENTS_ALLOWED = false` in `packages/domain/src/payments/rules.ts`). The webhook is verified by signature and replay-safe.
- **Documents and publishing:** photo ID is required in every category; further required and optional documents per category are edited in the back office (`docs/required-documents-draft.xlsx` has the starting table). Staff check documents by hand. A profile goes live only when complete and every required document of a service is approved (`services.offerable` is kept by triggers).
- **Delete and export:** deleting an account needs the password, removes everything in one transaction (files are removed after the commit and retried by the daily job) and the Neon Auth records; a provider's basic trader details and document metadata are kept 6 months (`DELETE_RETENTION_MONTHS`, 0 switches it off). The export returns the person's own data as JSON or CSV.
- **Texts:** `packages/i18n` is split into app, language and server catalogues, so the app ships only its own texts.
- **Environments:** Production = Vercel Production on Neon branch `kando-main` (endpoint `ep-empty-sound-b948a10w`); Preview and the phone-test accounts = Neon branch `kando-dev`. Neon project `withered-wave-83432300`. Variables, the first staff account and deployment steps: `docs/deployment.md`.

## Run it

Needs Node 24, pnpm 10 and Docker.

```
docker compose up -d --wait db      # Postgres 17 + PostGIS on localhost:5433
pnpm i
pnpm test                    # web (Vitest, Docker database), app (jest), domain, contract, texts
pnpm typecheck && pnpm lint
pnpm --filter web dev        # website on http://localhost:3000
```

Copy `.env.example` to `.env.local` (every variable is listed there). `DATABASE_URL_TEST` defaults to `postgres://postgres:postgres@localhost:5433/kando`; two test runs at once on one database break each other. Database change: `pnpm db:generate`, then `pnpm db:migrate` (direct, unpooled connection string) against `kando-dev`, and against `kando-main` BEFORE the code that needs it is deployed.

**Phone testing:** the app is the development build "SkillWeb (Development Build)" from EAS (Expo project `b66a6d0d-2214-47e3-85be-cd5501e24f6c`, owner `liezljvv74`). Start `cd apps/mobile && npx expo start --dev-client --tunnel` with `EXPO_PUBLIC_API_URL=https://skillweb.space` in `apps/mobile/.env`; scan the QR code with the development app's own scanner (the address must start with `https://`). A new server address must first be added to Neon Auth: `neon neon-auth domain add <address> --project-id withered-wave-83432300 --branch <branch>`. Stop the server when done. The iPhone needs a paid Apple Developer account for a development build; Android works today.

**Test accounts:** `pnpm db:seed:test-users` creates customers and published providers from `packages/domain/seed-data/test-users.json` (not in git; copy `test-users.example.json`). The seed tool refuses any database but the dev branch. On 31 October 2026 test accounts were also created on production by a one-off script so the phones can use the live site; **they must be deleted before launch**.

## Where we are (3 November 2026)

### Resume here (read this first if a session closed unexpectedly)

**Pull requests.** Merged: #58 to #69 (welcome screen, step 1.6 and 1.6b, error texts, quotes side by side with the limit of 5 open requests, lapsed bookings, tracker and decision documents). **Open, waiting for the owner:** #70 (the AI document check, migrations 0029 and 0030) and #71 (sign-up checkbox for the terms and privacy policy, migration 0031, **stacked on #70: merge #70 first**). Both have been through two `/code-review --comment` rounds and an architecture review; fixes are pushed; the full web suite passed on #70 (931 tests). The owner submits the GitHub approval and merges. Nothing else is in flight.

**Database.** `kando-main` (production) and `kando-dev` have migrations 0000 to 0028. **0029, 0030 and 0031 are not applied anywhere.** Order: apply to dev (`pnpm db:migrate` with the dev direct URL), then to production, **before** the code of #70 and #71 is deployed. Test them first on a throw-away Neon branch of production (`neon branches create --parent kando-main`, delete it afterwards; **the create command prints the connection string with the password: do not paste that output anywhere**). The production password for `neondb_owner` was reset on 3 November 2026 and the Production variables `DATABASE_URL` and `DATABASE_URL_UNPOOLED` in Vercel were updated by the owner; the site was checked afterwards (home 200, categories API 200, protected routes 401). Preview variables point at dev and were not touched.

**The AI document check (Phase 2, built, not live).** Code is in #70. It stays off until `OPENROUTER_API_KEY` and `AI_DOCUMENT_MODEL` are both set; the owner set `AI_DOCUMENT_MODEL` and `AI_DOCUMENT_PROVIDER` on Vercel Production on 3 November. Chosen: `anthropic/claude-sonnet-5.5` pinned to `google-vertex` (model comparison on 20 made-up documents, `Reports/ai-document-check-evaluation-*.md` if kept: 17 of 20 right, no problem document approved, about 0.004 USD per document, 2 to 5 seconds; a Haiku model id failed every call, probably a wrong id). Rules: the AI only approves when sure (confidence 0.8, type and name match, photo IDs need a certain expiry date and the person's own name), never rejects, 10% spot check, hourly limit 10 per person, monthly cap 20 euro (`AI_MONTHLY_CAP_EUR`), cost records survive document deletion, photo ID images are deleted 30 days after the AI check and at once with the account (owner decisions of 3 November: staff ask for a re-upload when an image is gone; every photo ID image goes with the account), a check killed mid-way is closed by the daily route after 10 minutes. An account without a recorded acceptance of the terms (`users.terms_accepted_at`, from #71) is never sent to the AI. **Do not deploy #70 before migrations 0029 and 0030 are on production.**

**Legal pages in the back office.** Drafts exist (unpublished, German and English, dev and production): slug `agb` (terms, with the new section 5a on the AI check) and `datenschutz` (privacy, with section 4a). They contain `[square brackets]` (address, legal form, notice period, jurisdiction, authority, dates, processor confirmations) that the owner must fill in, then publish. The sign-up checkbox links to them; until they are published the links show "not found". German was written by Claude from the English; a German speaker should read it. Sources: `docs/legal-drafts/legal-pages-drafts.md`, `ai-document-check-legal-text.md` (arrives with #70), `dpia-ai-document-checks-draft.md`.

**Owner to do (nothing here is done by Claude without being asked):** merge #70 then #71; tell Claude to apply migrations 0029 to 0031 (dev, then production); fill in and publish the two legal pages; confirm with OpenRouter and the model provider where data is processed (EU?) and that they do not train or retain (the app asks for it, it cannot prove it); sign off the data protection impact assessment; ask the lawyer about the 6-month trader retention and the wording in the terms; then walk through Flow 1 on a phone (step 1.10) including a Stripe test payment; check the EAS build started on 3 November (`npx eas-cli build:list`, preview Android, id `66f0be5e-e31c-4954-8235-d339219fa3f7` at the time) and install it.

**Claude to do next (in order).** (1) After #70 and #71 are merged: record #67 to #71 with `python docs/mvp/update.py --note "..." --merged 67 --merged 68 ...` and write the workbook once (the workbook must be closed in Excel first; it is one file, updated after every 2 merged code PRs). (2) Step 1.7: run all suites once, write `Reports/Flow-1-Test-Report.xlsx`, update this README, write the phone test script with tap counts. (3) Step 1.9 release checks. (4) Later, on request: a prompt asking existing users to accept the terms; the quote assistant (with the small "AI-written" label); the integration-tmp branch (7 UI commits, no PR) needs comparing with main before it is deleted; delete the old worktrees under `.claude/worktrees/` and the local test databases (`kando_terms`, `kando_aipin`, others) in the Docker container.

**Working rules learned the hard way.** Verify every push landed (`git ls-remote origin refs/heads/<branch>` equals the local head; an agent worktree on a detached HEAD pushes nothing silently, use `git push origin HEAD:<branch>`). No force push, no writes to Vercel secrets and no history rewrite without the owner's explicit approval (the permission system blocks them). Never print connection strings or keys. Each agent works in its own worktree with its own local database (`DATABASE_URL_TEST`), because a shared database makes parallel test runs interfere. Run the full web suite once before pushing a PR that changes what a route returns: CI runs everything (a cron route test failed there after the new field was added).

### State of the product

- **Production:** https://skillweb.space runs `main` (includes #69). Stripe test mode is on in Production.
- **Flow 1 (request, quotes, confirm, pay) is built and merged** (steps 1.1 to 1.6d): several quotes per request stay valid side by side, each with its own Accept button; the customer sees a table of accepted quotes; at most 5 open requests per customer and provider pair; a lapsed booking tells the customer and offers "I don't need this anymore"; the direct booking path and the status `proposed` are gone (migration 0028); the app role can no longer insert bookings (#68); every error text names the problem and the action.
- **Automated tests:** CI on #70: web 931 passed (1 skipped), mobile and typecheck green. The full domain and contract suites and the whole-repo lint (38 older errors in scratch scripts) are part of step 1.7. Older reports: `Reports/Stage-1-Test-Report.xlsx` to `Stage-2e`, `Assessment-Stage-A` to `D`, `Assessment-Fixes-Combined-Report.xlsx`.
- **Not yet tried by a person:** Flow 1 on a phone, the new notices, the welcome screen, and a real Stripe test payment. Logged-in screens and the daily cron cannot be tested from a terminal.
- **Project tracker:** `Reports/MVP Completion Tasks.xlsx` (Plan sheet) is one file, updated in place by `python docs/mvp/update.py` after every 2 merged code pull requests (pull requests that only change documents do not count). Four dated copies from 1 November are old and can be deleted.

### What the app cannot do yet (do not promise these)

- AI: the document check is built but not live until #70 is deployed and its migrations applied; there is no quote assistant (planned, later). The other AI feature is the translate button on provider pages.
- Not in the app stores; the sign-up terms checkbox comes with #71 (existing accounts are never asked); no "report this profile or photo"; no web page to request account deletion; the legal pages are drafts until published.
- Payments are Stripe test mode only; live payments are blocked in code. The commission (12%) and the platform's company details are placeholders.
- No availability calendar or instant booking (Flow 2 is only an outline: `docs/superpowers/plans/2026-11-01-flow-2-availability-and-instant-booking-outline.md`); no inbox screen with counts and "tentative" bookings; the chat polls every 4 seconds (no live push).

## Next steps to finish the MVP (the order of the Plan sheet)

**Phase 1: finish Flow 1**
1. **Merge #70, then #71** (owner: `/code-review --comment`, GitHub review with Approve, merge); apply migrations 0029 to 0031; publish the two legal pages.
2. **Steps 1.1 to 1.6d, 1.8 (owner decisions: street privacy as built, no second PDF, PDF in the provider's language, default German):** done.
3. **Step 1.7:** run all suites once, write `Reports/Flow-1-Test-Report.xlsx`, update this README, write the phone test script.
4. **Step 1.9, release:** merge, check production, new Android build (`eas build --profile preview --platform android`).
5. **Step 1.10:** phone walk-through on Android with the test accounts, including a full Stripe TEST payment (cards 4242 4242 4242 4242, declined 4000 0000 0000 0002, 3-D Secure 4000 0027 6000 3184); fix what it finds. The earlier checklist still applies: uploads (portfolio photo, document PDF and photo, chat photo; if an upload fails with 411 remove the single line `if (opts.prepare && length === null)` in `packages/domain/src/app-request.ts` and its test), delete an account with a wrong then the right password, "Offer services", the Open buttons on notices, airplane-mode Retry.
6. **Owner dashboard actions** (list under "Pre-launch tasks", section 1) run alongside.

**Phase 2: AI document check** (plan: `docs/superpowers/plans/2026-11-01-ai-document-check.md`). Steps 2.2 to 2.6 are built in #70 (see "Resume here": migrations, the Vercel variables, the model choice and what must happen before it is deployed). Step 2.1 (provider choice) is decided: OpenRouter, Claude Sonnet 5.5 pinned to Google Vertex. Still open: the data protection impact assessment sign-off, the confirmation of the data location, the lawyer's view, and the quote assistant (later).

**Phase 3: security and compliance:** the full security scan and fixes (3.1), secrets and Vercel Preview clean-up (3.2), legal pages, age and terms tick, "report this profile or photo", deletion request page (3.3), a real account deletion on the live Neon Auth (3.4), a recorded review on a GitHub PR (3.5). Enforce the script policy: if the report-only Content-Security-Policy shows no violations, enforce `script-src` in `apps/web/next.config.ts`.

**Phase 4: quality and evidence:** green lint and typecheck on the whole repository and green CI (4.1), demo data on production and deletion of the test accounts (4.2), README top section and scorecard (4.3).

**Phase 5: presentation:** deck and recorded demo (5.1), showcase upload and rehearsal (5.2).

**After the MVP:** inbox design (a top bar with an inbox icon, "My requests & bookings" and "Messages", and "tentative" bookings: open question whether it holds the time slot and for how long), availability and instant booking (Flow 2), deposits, recurring jobs, opening hours, per-category cancellation rules, AI help for the chat contact check, realtime chat with read markers, saved payment method, DAC7 data collection, the Preise page, Inngest for background work, thumbnails, South Africa.

## Decisions still to be made (owner)

1. **Commission percentage** (`COMMISSION_RATE` is a placeholder of 12% in `packages/domain/src/payments/rules.ts`) before payouts or the Preise page go live.
2. **Cancellation rules:** the 50 percent late-cancellation fee, the 48-hour no-show objection and the 7-day stop-job answer (lawyer to confirm, see below).
3. **Retention periods:** notices 180 days, Stripe events 90 days, device tokens 270 days, blocked contact text 90 days, trader records 6 months (`packages/domain/src/retention.ts`).
4. **The 25 megapixel picture limit** also refuses very high-resolution document scans (a 600 dpi A4 page is about 35 megapixels): keep, or raise for documents.
5. **Provider legal status:** no screen sets a provider's legal status or VAT id, so every provider is "private" and gets receipts; decide how providers state this.
6. **What stays optional:** liability insurance, trade registration and craft qualification are optional in every category for now; decide before launch whether they become required again for cleaning, gardening, moving, assembly, small repairs, catering and dog walking (back office, Categories).
7. **Version 1 text:** the home texts describe requests, quotes, in-app payment and "genuine reviews only after paid jobs"; before store submission they and the store listing must say only what the app does.
8. **AI provider** for document checks: decided (OpenRouter, Claude Sonnet 5.5 pinned to Google Vertex, 3 November 2026). Still needed before it goes live: confirm the processing agreement, that data stays in the EU where possible and is not trained on or kept, and the data protection impact assessment sign-off (`docs/legal-drafts/dpia-ai-document-checks-draft.md`). Until #70 is deployed with its migrations, staff check documents by hand.
9. **Vercel plan:** Pro is needed for commercial use, hourly timers and the four cron jobs.
10. **The "tentative" booking state** (see next steps, 3).

## Pre-launch tasks

**1. Owner actions in the dashboards**
- **Vercel, Environment Variables:** untick Preview on the live storage keys, `RESEND_API_KEY`, `OPENROUTER_API_KEY` and `CRON_SECRET`, and give Preview its own test values; check the Stripe key on Preview is a test key (`sk_test_` or `rk_test_`).
- **Vercel plan and firewall:** confirm four cron jobs are allowed; add rate-limit rules (login, chat, uploads, search) and a body-size rule.
- **Domain:** confirm `skillweb.space` has no HTTP-only subdomain (HSTS now includes subdomains).
- **Stripe:** webhook endpoints for the Preview address (with the Vercel protection bypass), see "Stripe set-up".
- **Neon:** a storage access key for `kando-dev` (update `AWS_ENDPOINT`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` for Preview in Vercel and the local `.env`); a separate storage key for `kando-main`; Neon Auth: custom email sending, "Require email verification", cookie flags and login limits.
- **Hosting checks:** preview database branch, Stripe key prefix, bypass secret, fork-PR protection, build-log exposure, a second factor for staff accounts.
- **First administrator on production:** not verified for liezljvv74@gmail.com. Sign up on https://skillweb.space, confirm the code, then run the SQL statement in `docs/deployment.md` against `kando-main`; walk through the back office once.
- **Email:** verify the Resend sending domain and send a test email from production.
- **Push (Android):** upload the FCM credentials with `npx eas-cli@latest credentials`; iOS needs the paid Apple Developer account (APNs key). Optional: `EXPO_ACCESS_TOKEN` on Vercel. After credentials, make a new development build (`eas build --profile development`).

**2. Legal and tax (the stores and real payments need these)**
- **Legal pages:** finish and publish Impressum, Datenschutz, AGB and Ranking in the back office in German and English (drafts: `docs/legal-drafts/legal-pages-drafts.md`). Missing: the company's legal form and postal address (company Amplivine, contact info@skillweb.space, person responsible Liezl Fourie, no VAT number), register entry, the small-business VAT rule, free or paid for now, AGB notice period and jurisdiction, the competent data protection authority, retention periods, signed processing agreements (Neon, Vercel, Resend, OpenRouter, Stripe). Then a lawyer's check and a German native read.
- **Platform entity:** `PLATFORM_ENTITY` (legal name, address, tax number) is a placeholder; a code guard refuses to issue platform documents while payments are live. Fill in the real details.
- **Real payments:** a code change of `LIVE_PAYMENTS_ALLOWED` and live Stripe keys, only after the lawyer's points below are settled. Real Stripe account: Connect as marketplace in Germany, Accounts v2, manual payouts, delayed payment methods off.
- **Delete the test accounts on production** (the names with garbled umlauts, such as "JÃ¼rgen", come from the seed and are cosmetic).

**3. Build tasks before submission**
- Sign-up tick "I am 18 or older and accept the terms and privacy policy".
- Web page where people can request deletion of their account and data (Google Play requires it in addition to the in-app button).
- "Report this profile or photo" (the stores expect report, block and a moderation contact; reporting and blocking exist in chat only).
- Home texts and store listing match what exists; remove the "coming soon" lines that are not true at submission.
- Photo thumbnails; documents over 4.5 MB (upload straight to storage); correction invoices for refunds after payout or chargebacks; poll Expo push receipts.

**4. Stores**
- Apple Developer Program (bundle id `space.skillweb.app`) and Google Play Console (package `space.skillweb.app`); registration can take days.
- Listing: icon, splash, screenshots in the required sizes, short and long descriptions in German and English, category, age rating, support address, Google data-safety and Apple privacy-label answers. Real graphics replace the placeholders.
- A demo customer and a published demo provider on production, with notes for the reviewer.
- Production build with EAS (`eas.json` already points `preview` and `production` at https://skillweb.space), test on a real phone, then submit (Android internal test first, iOS through TestFlight).

**5. Final checks**
- Phone test in German and English on a small and a large phone with large system text (empty states, airplane mode, keyboard never hiding a field, contrast, back buttons); the first runs of all four cron jobs visible in Vercel; every back-office screen in a browser.
- A security scan of the whole project just before launch (row-level security, routes, Vercel settings).
- Clean-up: delete the old GitHub repository `SkillWeb`, the old Vercel project `skillweb`, the local folder `Skilled\skill-web` (copy its `.env` files first if a backup is wanted), the old Neon branch `main` (cannot be deleted while `kando-dev` is its child), the local worktree `..\KANDO-phone-test`, and the local-only branches `account-address-saved` and `integration-tmp`; then remove the word "Payload" from `docs/deployment.md`.

## Stripe set-up (owner; test mode, code refuses live keys)

Done on 30 and 31 October 2026 for Production: sandbox account, Connect, Accounts v2, the secret test key and both webhook endpoints. For Preview and for a repeat:

1. Stripe Dashboard (sandbox): Connect as a marketplace in Germany; Accounts v2 on; platform payouts **manual**; delayed payment methods (SEPA debit) **off**.
2. Two webhook endpoints, both `https://<the site>/api/stripe/webhook`, both pinned to API version `2026-09-30.endive`: from **"Your account"**: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.dispute.created`, `refund.failed` (signing secret = `STRIPE_WEBHOOK_SECRET`); from **"Connected accounts"**: `account.updated` (signing secret = `STRIPE_CONNECT_WEBHOOK_SECRET`).
3. A restricted test key (`rk_test_...`) or the secret test key: write for Checkout Sessions, Transfers, Refunds, Connect v2 accounts, account links and Balance Settings; read for PaymentIntents.
4. Environment variables: `PAYMENTS_ENABLED=true`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`, `NEXT_PUBLIC_SERVER_URL`. Never paste a key into a chat, a commit or a report.
5. Vercel Deployment Protection blocks Stripe on preview URLs: add `?x-vercel-protection-bypass=<Protection Bypass for Automation secret>` to the Preview webhook URL.
6. `pnpm payments:smoke` (test key in `.env`; with `NEXT_PUBLIC_SERVER_URL` and `VERCEL_AUTOMATION_BYPASS_SECRET` for a protected preview) prints PASS, FAIL or SKIPPED for account, onboarding link, Checkout session, readiness, bad signature and "e webhook reachable". A 404 on step e means payments are off on that deployment; 401, 403 or an HTML page means Deployment Protection blocks Stripe.
7. Rules of operation: never switch `PAYMENTS_ENABLED` off within 24 hours of the last pay link; resend a failed webhook event from the Dashboard within 3 days; if the webhook was unreachable for more than 10 minutes, check Developers, Webhooks for failed deliveries (a payment just before the pay-by time can otherwise be refunded and the booking expire); a payment that could not be processed raises a staff flag. Refunds after the money was released are done in the Stripe dashboard.

## Questions for the lawyer and tax adviser

**Lawyer** (do not publish the related texts before these are settled; the design bans "Treuhand", "Escrow" and "Garantie" in product and marketing texts):
1. Is holding the customer's money until the job is done, through Stripe Connect, allowed without KANDO needing its own payment licence, and which wording is safe?
2. The 14-day right of withdrawal against cancellation fees, and what the customer must acknowledge when work starts inside the period.
3. Are free cancellation up to 24 hours before, 50 percent after that and the full price for a no-show valid in the AGB for private customers (babysitting and dog walking in particular)?
4. May staff decide disputes, is the decision binding, and what must the site say about out-of-court dispute resolution for consumers?
5. What must the site say about reviews coming from people who really booked, and what may staff hide?
6. Keeping trader documents 6 months after account deletion; whether private persons need a trade registration; whether the EU Digital Services Act "know your trader" duty applies to Amplivine.

**Tax adviser:** VAT on cancellation and no-show fees; a business invoice for a remote job has no customer address; commission amounts are treated as gross and the `vatNote` is a placeholder; whether private providers need a commission invoice at all; refunds after payout or a chargeback leave the invoices standing (no correction invoice); account deletion is refused when the current month's commission was already issued.

## Known gaps

- Photos load at full size (no thumbnails); documents over 4.5 MB cannot be uploaded through Vercel.
- Deleting an account removes Neon Auth records through their foreign keys; the password check was tested against Neon Auth sign-in in code, but a real deletion on the live Neon Auth has not been done.
- Chat contact-detail check is rules only: social handles, numbers split by other words, letter swaps and other languages can get through, and numbers inside photos are not checked.
- Expo push receipts are not polled; anyone who knows a push token can send pushes to that phone (low risk).
- Confirm, cancel and stop take longer because invoicing runs inline (to move to Inngest later).
- Provider-available and watcher notices ignore the invoice consent while payments are off.
- Placeholder graphics (app icon, splash, home page pictures); the legal pages are records that staff must write and publish in the back office.
- **Stand-in start time (flow 1, to revisit).** A quote confirmed without a date and time becomes a booking in status `awaiting-time`. The booking row must have a `start_at`, so it carries a stand-in: the request's own time, or, if that has already passed, the end of the 7-day waiting period. Nobody agreed that time. Nothing reads it for `awaiting-time` today (no slot is held, no payment is asked, the app must show "date and time to be confirmed"), but any future calendar, feed or report that reads `bookings.start_at` without checking the status would show an appointment that was never made. **Revisit later:** make `start_at` nullable for `awaiting-time` (a schema change that touches every reader), or always filter on status. Found in the code review of PR #47.
- Before South Africa: the website footer links to the German legal pages directly, the language switches assume exactly two languages, email dates use one time-zone constant (`TIME_ZONE`, Europe/Berlin), and a country missing from the countries table fails the postcode check.

## How this project is built with Claude Code

The owner directs; Claude Code builds. `CLAUDE.md` holds the rules every session follows (owner merges every pull request, a review before each merge, tests per task and full suites per stage, German and English texts, no secrets in the repo). `.claude/` holds the subagents, slash commands and skills that were used (`.claude/README.md` says which and for what): security scanners for the Next.js app and the Vercel layer, an architect and a researcher agent for designs and fact-finding, a code-review agent, an `rls-check` agent, `/security-scan`, `/test-report`, and the brainstorming, plan-writing and subagent-driven-development skills that produced the written plans in `docs/superpowers/plans/`. Work is planned in writing first, built task by task with a review per task, and every change goes through a pull request that the owner reviews and merges; review findings and their fixes are written up in `Reports/` (for example `PRs-46-47-Review-Report.xlsx`). The order of the remaining work toward the capstone assessment is the Plan sheet of `Reports/MVP Completion Tasks.xlsx` (one file, updated in place by `python docs/mvp/update.py` after every 2 merged code pull requests). Row-level security and sign-in evidence: `docs/rls-and-auth-evidence.md`.

## How a new session starts

Open the session in this folder, read this README (start with "Where we are", the block "Resume here"), run `gh pr list` and `git pull`. Local tests need Docker. Test reports are Excel files in `Reports/` (copy the layout of `Reports/Stage-1-Test-Report.xlsx`). Local-only notes (git-ignored): `.work/` and `.superpowers/sdd/<plan>/progress.md` ledgers on the owner's PC.
