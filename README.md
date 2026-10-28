# KANDO: SkillWeb rebuilt

The new home of SkillWeb, a service marketplace for Germany: households book trusted, verified local helpers and small businesses, pay when the job is done, and get the paperwork included. This repository replaces the earlier Payload-based repository (`SkillWeb`), which still runs the live site at skillweb.space until the cutover described under "Retiring the old Payload stack" below.

- **Design:** `docs/specs/2026-10-26-kando-foundation-design.md` (what the first release does, the decided stack, the rules, the stages). The registration and provider-setup design is `docs/specs/2026-10-27-registration-and-provider-setup-design.md`; its plan is in `docs/plans/`.
- **Stack today:** Expo app (`apps/mobile`); Next.js on Vercel for the website, the staff back office (Refine, German and English) and the API (`apps/web`); Neon Postgres with PostGIS and row-level security, Neon Auth and Neon Object Storage; Drizzle (`packages/db`); business rules in `packages/domain`; shared input rules in `packages/contract`; one text catalogue in German and English (`packages/i18n`); Resend for email; OpenRouter for the translate button. **Planned, not built yet:** Inngest for background work, Stripe behind a payments interface, Neon Realtime for chat.
- **Rules for this project:** every change through a pull request merged by the owner (use "Squash and merge" and delete the branch); a test report in `Reports/` after every stage and every big change; no competitor names anywhere; no AI co-author or "Generated with" lines; every user-facing text exists in German and English; South Africa follows later, so no new Germany-only assumptions.

Layout: `apps/mobile`, `apps/web`, `packages/db`, `packages/contract`, `packages/i18n`, `packages/domain`, `Reports/`, `docs/`.

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

Everything below is merged into `main` and live at https://kando-web.vercel.app (Vercel project `kando-web`, root `apps/web`). That test site runs on the Neon branch `kando-dev` and holds test data only. All automated tests pass: 425 (274 web, 127 app, 24 in the shared packages); typecheck, lint and the Android bundle build are clean.

### What was built, in order

- **Stage 1, the foundation (27 October, PR #2).** Database with row-level security, login with an email code (Neon Auth), the app API, photo and document storage, the translate button, document review, the staff back office under `/admin`, the public website, the phone app and the seeds. Fourteen tasks, each reviewed, plus a review of the whole branch. Payload is not part of it. Report: `Reports/Stage-1-Test-Report.xlsx`.
- **First staff account and the search list (PRs #3, #4).** Staff roles are set in the database (see `docs/deployment.md`). The Search tab now refreshes when you come back to it, so a provider suspended in the meantime disappears.
- **Back office in German and English (PR #5).** The language comes from the `admin-lang` cookie, else the browser language; a button in the header switches it. This also stopped a crash that Chrome's automatic translation caused. Report: `Reports/PR-5-Back-Office-Language-Test-Report.xlsx`.
- **Registration and one-page provider setup (PRs #6 to #8, #10).** Report: `Reports/Registration-Setup-Test-Report.xlsx`. See "How it works now".
- **Phone-test fixes (PR #11).** A postcode alone now saves as an address; a "Saved" message appears after saving in Account; "Offer services" and "Become a provider" open the profile page directly; the provider card moved under "Find help now" on Home. Report: `Reports/PR-11-Phone-Test-Fixes-Test-Report.xlsx`.

### How it works now

- **Sign-up** asks for first name, surname, email, password, an optional picture (with the reason: providers see who they work for, which is safer), an optional address and one tick, "I also want to offer services". Only the postcode of the address is required if you give one; street and city are optional and stay private. The answers are kept on the phone until the email code is confirmed, and only ever applied to the account they were made for.
- **My service profile is one page.** Opening it creates an empty draft. Every field saves as you type, so nothing is lost if the app closes. It holds services (category compulsory, title filled from the category when left empty, price type, price, "Add another service"), About you, past jobs, portfolio, and a red card listing the documents a category needs. The **Publish** button lists what is still missing until the profile is complete; a live profile cannot be edited into an incomplete state.
- **After Publish** the provider sees "Your profile is live. Tell people about it." with a Share button. If a document check is still pending, the message says the service goes live after the check and there is no Share button.
- **The My profile tab is for providers only.** A customer opens the same page through Account, Offer services (or the card on Home), which creates the draft, makes them a provider and then shows the tab.
- **Emails say what really happened:** document approved (profile live, service visible, profile offline, profile suspended), document rejected with the staff note, profile suspended with reason and end date, profile published again. When the last pending document is approved there is also a banner with Share and a dot on the Account tab.
- **Suspensions end by their date.** A daily check at 06:00 UTC (`/api/cron/suspensions`, protected by `CRON_SECRET`) ends the ones whose date has passed; staff can lift earlier. Emails only go to people whose profile was live.
- The public name is first name plus the first letter of the surname (or the business name) and follows a rename.

### Phone testing

The app is the development build "SkillWeb (Development Build)" installed from the EAS build page. To test against the live test site:

```
cd apps/mobile
# .env holds EXPO_PUBLIC_API_URL=https://kando-web.vercel.app (git-ignored)
npx expo start --dev-client --tunnel
```

Scan the QR code or enter the printed address (starting `https://`) under "Enter URL manually" in the development app. A different server address must first be added with `neon neon-auth domain add <address> --project-id <id> --branch kando-dev`. Stop the server when you are done.

### Test accounts (dev branch only)

`pnpm db:seed:test-users` creates customers and published providers from `packages/domain/seed-data/test-users.json`. Each person has `firstName` and `lastName` and an optional address; the public name is built from the names. That file is not in git (the repository is public) and lives on this PC only; a fresh clone starts from `test-users.example.json` (copy it to `test-users.json`). The password is in the file; emails are created verified. Seeds refuse to run anywhere but the dev branch. `kunde.berlin@example.com` is an Administrator on `kando-dev` for the back office.

## Outstanding

### Tests that must still be done

Nothing has been checked on a phone or in a real browser yet; every "Not yet done" row in the reports' Other Checks sheets is on this list.

1. **Customer sign-up** with your own email: names, picture, postcode only; confirm the code; Home shows no My profile tab; the picture nudge disappears once a picture is added.
2. **Account, Offer services** (and Home, Become a provider) opens the profile page directly, the tab then appears. Airplane mode: an error shows and you stay put. A second tap does nothing.
3. **Sign-up with the provider tick** lands on "Let's set up your service profile"; nothing from a previous account carries over after sign-out and sign-in as someone else.
4. **The profile page:** fill it, close the app halfway and reopen (typing must be there), add a second service, check the keyboard never hides a field, upload a document by file, gallery and camera; Publish is grey with a list until complete.
5. **Publish and Share:** the Share sheet opens; with a pending document check there is no Share button.
6. **Back office in a browser** (https://kando-web.vercel.app/admin): approve and reject a document (emails, banner, dot), suspend and lift a user (emails, search, public page), categories, pages (publish an Impressum and see it on the site), staff roles, the language switch, no crash page.
7. **Account tab:** a postcode alone saves, "Saved" appears and goes, a badly formed postcode shows its message, fields lock while saving.
8. **Older checks never done on a phone with this app:** password reset by code, a wrong sign-up code, the translate button, Live switch off and on, profile and portfolio photos, the 7-day session (open the app a day later and still be signed in), the daily suspension check at 06:00 UTC (first run), email delivery from Resend.
9. **Security scan** of the whole project (row-level security, routes, Vercel settings) before launch.

### Small points parked from the reviews

- A bad postcode typed at sign-up is dropped silently (the error shows in Account).
- Details: the Open Items sheets of the reports in `Reports/`.

### Retiring the old Payload stack

KANDO contains no Payload code. What remains is the old repository and its running parts. The owner chose to go ahead (28 October); steps 2 to 4 are done or half done, see "Cutover progress" below.

1. Finish the tests above and fix what they find.
2. Production holds only test data, so no data is moved. **Confirmed by the owner.**
3. Production Neon branch `kando-main`. **Done** (see below).
4. Production settings in Vercel for `kando-web`. **Partly done** (see below).
5. Write the legal pages in the back office (Impressum, Datenschutz, AGB, Ranking); replace the placeholder graphics. **Not started: needs the owner's input.**
6. Host the new site on skillweb.space (there is no new domain): move it from the old Vercel project `skillweb` to `kando-web`; build the app for the stores with `EXPO_PUBLIC_API_URL=https://skillweb.space` (same package `space.skillweb.app`). **Not done.**
7. In the old repository: close the open pull requests (#15 translate button, whose work is already here, and #16 design), archive it on GitHub, and copy its git-ignored `Marketing/` folder somewhere safe first. Delete the old Vercel project and, after a waiting period, the old Neon branches `main` and `dev`.
8. Then remove the "Payload" wording from this README and from `docs/deployment.md`.

### Cutover progress (28 October 2026)

**Done**

- Neon branch `kando-main` (endpoint `ep-empty-sound-b948a10w`) was created as a copy of `kando-dev` (schema-only copies are not available on this project). All test data was then removed from it: every user, login account and session, all providers, services, photos, references, documents and notifications, and the login signing key. It holds the 14 categories, the 10,815 postcodes, Germany and the euro, and migrations 0000 to 0008 are applied (`pnpm db:migrate` ran clean, row-level security applied).
- Neon Auth on `kando-main` has its own address; `https://skillweb.space` and `https://kando-web.vercel.app` are trusted there. The storage buckets `media` and `documents` exist on it.
- Vercel `kando-web`, **Production** now uses `kando-main`: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEON_BRANCH=kando-main`, `NEON_AUTH_BASE_URL`, a new `NEON_AUTH_COOKIE_SECRET`, and `NEXT_PUBLIC_SERVER_URL=https://skillweb.space`. **Preview** still uses `kando-dev`. `RESEND_API_KEY`, `OPENROUTER_API_KEY`, `TRANSLATE_MODEL` and `CRON_SECRET` were already set for both. (The old project's key values are hidden by Vercel and cannot be read back, so nothing was copied from it; the keys in `kando-web` were already in place.)

**Not done yet**

- **Production has not been redeployed**, so the live site still runs on the old values. Redeploy `kando-web` in Vercel (Deployments, the latest one, Redeploy), then open https://kando-web.vercel.app and check it works against the empty `kando-main`.
- **The first staff account on production.** Sign up on the live site with your own email, confirm the code, then run the one SQL statement in `docs/deployment.md` against `kando-main` (the connection string is in Vercel under `DATABASE_URL_UNPOOLED`; the Neon console SQL editor works too).
- **Storage keys:** Production still uses the project's default storage key, the same one `kando-dev` uses. A separate key for production was not created (the tool was blocked from creating one). Recommended before launch: create one in the Neon console for `kando-main` (read and write storage) and replace `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` for Production only.
- **Move skillweb.space** to `kando-web` (Vercel: remove the domain from project `skillweb`, add it to `kando-web`). Do this only after the redeploy above checks out; the old site goes offline at that moment. The old branches stay untouched as a fallback.
- Resend: confirm the sending domain used by the old project is verified for the address KANDO sends from, and send a test email from production.
- Neon Auth for production: custom email sending (shared sending is for development only) and the "Require email verification" setting, as in `docs/deployment.md`.
- Vercel Pro before launch.

**To decide, to continue tomorrow**

1. **Impressum and Datenschutz content:** I need the legal details (company or person name, address, contact, VAT number if any, who is responsible for content); I will not make them up. AGB and Ranking text: write them yourself or have a lawyer do it; I can prepare drafts to review.
2. **Graphics:** app icon, splash screen, home page pictures: supply the files, or tell me the style and I prepare options.
3. When to move the domain (after a successful production test), and how long to keep the old `main` and `dev` branches before deleting them.
4. Whether the phone tests run before or after the domain move (I recommend: redeploy, quick production check, phone tests against production, then move the domain).

### Next features

Stage 2 of the design: requests, quotes, direct booking, payments with Stripe Connect, ratings, chat, push notifications. Each starts with a design conversation.

## Known gaps

- No thumbnail sizes: the photo grid and the cards load full-size images.
- Documents over 4.5 MB cannot be uploaded through Vercel; the fix is to upload straight from the phone to storage.
- No "Delete my account" in the app (GDPR erasure and data export come later).
- Placeholder graphics (app icon, splash, home page pictures) are still to be replaced.
- The legal pages are records that staff must write and publish in the back office.
- Push notifications come with bookings; until then the banner and the email are the only signals.
- Before South Africa (not needed for Germany): the website footer links to the German legal pages directly, the website and back office language switches assume exactly two languages, and a country missing from the countries table makes its addresses fail the postcode check.
