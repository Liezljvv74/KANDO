# KANDO: SkillWeb

A service marketplace for Germany. Households find, request and book trusted, document-checked local helpers and small businesses; the customer pays through Stripe, the money is released when the job is done, and the paperwork (invoices, receipts) is included. Live at https://skillweb.space (project `kando-web` on Vercel). **State on 31 October 2026: the whole booking flow is built and on `main`; payments run in Stripe TEST mode only; the app is not in the app stores; no real customer or provider uses it yet.**

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
- **Public provider page:** picture, public name (first name plus the first letter of the surname, or the business name), place, categories, "Checked documents: ..." (approved document names only), a translate button (OpenRouter, limited per person and per day), strengths, skills, experience, services with prices (fixed, per hour, from, on request), past jobs, portfolio photos, and the legal notice for businesses. From here a customer **requests a quote** (any service) or **books directly** (fixed-price services).
- **My profile (providers):** cards that open their own edit screens: Services, About you, Past jobs (at most 2), Portfolio (at most 12 photos) and Verification documents; autosave; Publish and Unpublish. A card with everything it needs turns green; Publish stays grey until the profile is complete. Compulsory fields carry a "*": per service a category and price type; in About you provider type, at least one strength and one skill, postcode and service radius (default 25 km); a business also needs a business name and a legal notice. Skills and strengths stop at 20 entries.
- **Requests, quotes, bookings:** the customer writes a request; the provider sends a quote (revisable, valid 7 days) or declines; the customer accepts and proposes date, time and duration (on site or remote); the provider accepts, counters or declines; the customer can withdraw. A request whose quote-born booking ends unagreed returns to "quoted" while the quote is still valid. Busy times are respected (first come, first served, with a travel buffer on site). Lists load 50 at a time with "Show more". One open request per customer and provider; at most 10 requests or direct bookings per customer per day.
- **Paying (when payments are on):** the customer pays an accepted booking on Stripe's hosted page (the full amount); the booking becomes **Confirmed** when Stripe tells the server. Providers set up payouts through a Stripe-hosted form and get a verified mark; a customer cannot book a provider who is not ready, but can tap **notify me**. A booking more than 60 days ahead cannot be paid. The pay card knows from the start whether payments are on.
- **Finishing, cancelling, disputes, reviews:** the provider taps Finished; the customer has 7 days to confirm (reminders after 1, 3, 6 days); on confirmation or after 7 days of silence the money is released (commission kept). Cancelling a confirmed booking is free more than 24 hours before the start and costs 50 percent after that; a no-show can be reported and the other side has 48 hours to object. After Finished or Stop either side can open a dispute; staff decide (full payout, partial amount or full refund, always with a written reason, within 14 working days). **Stop job** ends a started job at an agreed amount (the other side answers within 7 days). An **additional task** is a linked booking with its own payment. After a completed job both sides can write a review (1 to 5 stars, hidden until both are in or 7 days have passed).
- **Chat:** one chat per request and booking, text (at most 2000 characters) and photos, quote and acceptance cards posted by the system; the app polls every 4 seconds (no live push). Phone numbers, emails and links are refused (also written in words); three blocked attempts in 24 hours flag the sender to staff; either person can report a message or block the other; at most 30 messages per 10 minutes. The same refusal applies to profile, service, past-job and name texts.
- **Notices, push and email:** 34 notice kinds; each goes by push if the phone has a token and the switch allows it, otherwise by email in the saved language. Push switches per kind are on the Account tab.
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

## Where we are (31 October 2026)

- **Production:** `main` at `cf77dac` (release PR #40) is deployed at https://skillweb.space. `kando-main` is at migration 0023 (24 migrations). Stripe test mode is on in Production (webhooks for "Your account" and "Connected accounts" set by the owner).
- **Automated tests on `main`:** web 849, domain 240, mobile 313, contract 22, i18n 18, all passed; typecheck clean (mobile has 4 older typed-route errors in `apps/mobile`); lint reports 38 older errors in scratch and marketing scripts. Reports: `Reports/Stage-1-Test-Report.xlsx` to `Stage-2e`, `Assessment-Stage-A` to `D` and `Assessment-Fixes-Combined-Report.xlsx` (33 findings, test results, review log, release checklist, owner actions).
- **Not yet tried by a person:** nearly everything. Android was used for earlier tests; the new build with push and the assessment fixes has not been walked through on a phone, nor has a real Stripe test payment.
- **Open pull requests:** #33 (Phase 2 combined review report) and #34 (first assessment report, superseded by the combined report). Both only add an Excel file; merge or close.

## Next steps (in this order)

1. **Owner dashboard actions** (list under "Pre-launch tasks", section 1): Preview environment values, Stripe Preview webhooks, `kando-dev` storage key.
2. **Phone walk-through on Android** with the test accounts: uploads (portfolio photo, document PDF and photo, chat photo; if an upload fails with 411 remove the single line `if (opts.prepare && length === null)` in `packages/domain/src/app-request.ts` and its test), delete an account with a wrong then the right password, "Offer services", the Open buttons on notices, airplane-mode Retry, and the full Stripe test walk (cards 4242 4242 4242 4242, declined 4000 0000 0000 0002, 3-D Secure 4000 0027 6000 3184; close before paying, then Refresh and Pay again). Fix what it finds.
3. **Inbox design talk** (owner item 5): a top bar with an inbox icon that turns red, a choice box "My requests & bookings" and "Messages" with counts, new items in bold, and "tentative" as a way for a provider to talk to a customer before accepting. The open design question: is "tentative" a real booking state that holds the time slot, for how long, and what does the customer see. Not built; only Open buttons and notices on Home and My bookings exist.
4. **Enforce the script policy:** open the site with the browser console open (home, a provider page, a legal page, payment-done, payout-done, the admin pages); if the report-only Content-Security-Policy shows no violations, enforce `script-src` in `apps/web/next.config.ts` (one line).
5. **Close the build gaps before submission:** sign-up age and terms tick, account deletion web page, report a profile or photo, real graphics, store listings (see "Pre-launch tasks").
6. **After launch:** deposits, recurring jobs, opening hours, per-category cancellation rules, AI document checks, AI help for the chat contact check, realtime chat with read markers, saved payment method, DAC7 data collection, the Preise page, Inngest for background work, thumbnails.

## Decisions still to be made (owner)

1. **Commission percentage** (`COMMISSION_RATE` is a placeholder of 12% in `packages/domain/src/payments/rules.ts`) before payouts or the Preise page go live.
2. **Cancellation rules:** the 50 percent late-cancellation fee, the 48-hour no-show objection and the 7-day stop-job answer (lawyer to confirm, see below).
3. **Retention periods:** notices 180 days, Stripe events 90 days, device tokens 270 days, blocked contact text 90 days, trader records 6 months (`packages/domain/src/retention.ts`).
4. **The 25 megapixel picture limit** also refuses very high-resolution document scans (a 600 dpi A4 page is about 35 megapixels): keep, or raise for documents.
5. **Provider legal status:** no screen sets a provider's legal status or VAT id, so every provider is "private" and gets receipts; decide how providers state this.
6. **What stays optional:** liability insurance, trade registration and craft qualification are optional in every category for now; decide before launch whether they become required again for cleaning, gardening, moving, assembly, small repairs, catering and dog walking (back office, Categories).
7. **Version 1 text:** the home texts describe requests, quotes, in-app payment and "genuine reviews only after paid jobs"; before store submission they and the store listing must say only what the app does.
8. **AI provider** for document checks and the chat contact check (recommendation: Mistral; needs data location in the EU, a processing agreement and no training on the data), and the data protection impact assessment sign-off (`docs/legal-drafts/dpia-ai-document-checks-draft.md`). Until then staff check documents by hand and the chat check uses rules only.
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

The owner directs; Claude Code builds. `CLAUDE.md` holds the rules every session follows (owner merges every pull request, a review before each merge, tests per task and full suites per stage, German and English texts, no secrets in the repo). `.claude/` holds the subagents, slash commands and skills that were used (`.claude/README.md` says which and for what): security scanners for the Next.js app and the Vercel layer, an architect and a researcher agent for designs and fact-finding, a code-review agent, an `rls-check` agent, `/security-scan`, `/test-report`, and the brainstorming, plan-writing and subagent-driven-development skills that produced the written plans in `docs/superpowers/plans/`. Work is planned in writing first, built task by task with a review per task, and every change goes through a pull request that the owner reviews and merges; review findings and their fixes are written up in `Reports/` (for example `PRs-46-47-Review-Report.xlsx`). The order of the remaining work toward the capstone assessment is the Plan sheet of `Reports/MVP Completion Tasks <date time>.xlsx` (a new dated version after every commit). Row-level security and sign-in evidence: `docs/rls-and-auth-evidence.md`.

## How a new session starts

Open the session in this folder, read this README, run `gh pr list` and `git pull`. Local tests need Docker. Test reports are Excel files in `Reports/` (copy the layout of `Reports/Stage-1-Test-Report.xlsx`). Local-only notes (git-ignored): `.work/` and `.superpowers/sdd/<plan>/progress.md` ledgers on the owner's PC.
