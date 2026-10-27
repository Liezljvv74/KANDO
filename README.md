# KANDO: SkillWeb rebuilt

The new home of SkillWeb, a service marketplace for Germany: households book trusted, verified local helpers and small businesses, pay when the job is done, and get the paperwork included. This repository replaces the earlier Payload-based repository (`SkillWeb`), which stays as reference until this one reaches feature parity and is then archived.

- **Design:** `docs/specs/2026-10-26-kando-foundation-design.md` (what the first release does, the decided stack, the rules, the stages).
- **Stack:** Expo app; Next.js on Vercel for the website, the staff back office (Refine) and the API; Neon Postgres (PostGIS, row-level security, Auth, Object Storage, Realtime); Drizzle; Inngest for background work; Stripe behind a payments interface; one text catalogue in German and English.
- **Rules for this project:** every change through a pull request merged by the owner; a test report in `Reports/` after every stage and every big change; no competitor names anywhere; no AI co-author or "Generated with" lines; every user-facing text exists in German and English; South Africa follows later, so no new Germany-only assumptions.

Layout once Stage 1 starts: `apps/mobile`, `apps/web`, `packages/db`, `packages/contract`, `packages/i18n`, `packages/domain`, `Reports/`, `docs/`.

## Run it

Needs Node 24, pnpm 10 and Docker.

```
docker compose up -d --wait db      # Postgres 17 + PostGIS on localhost:5433
pnpm i
pnpm test                    # web (Vitest, uses the Docker database); mobile joins later
pnpm --filter web dev        # website on http://localhost:3000
```

Copy `.env.example` to `.env.local` and fill it in for anything that talks to Neon, storage, email or translation. `DATABASE_URL_TEST` defaults to `postgres://postgres:postgres@localhost:5433/kando`.

## Where we are (27 October 2026)

Stage 1 is built (database with row-level security, login, the app API, photo and document storage, the translate button, document review, the staff back office under `/admin`, the website, the phone app and the seeds). On top of it, branch `registration-setup` adds registration and a one-page provider setup:

- **Sign-up** asks for first and last name, a private address and a picture, plus one tick: "I want to offer services". Nothing is lost if the confirmation code comes later: the answers are kept on the phone and saved when the email is confirmed.
- **My service profile is one page.** Opening it creates an empty draft. Every field saves as you type; services, references and documents sit on the same page. A **Publish** button at the bottom lists what is still missing, in plain words, until the profile is complete.
- **Checks, emails and the banner.** When staff approve a document, the provider gets an email that says what really happened (profile live, service visible, profile offline, profile suspended). When the profile goes live there is also a banner "Your profile is live. Tell people about it." with a Share button, and a dot on the Account tab.
- **Suspensions end by their date.** Staff choose the end date; the provider gets an email when it starts and again when the profile is published again. A daily check at 06:00 UTC ends suspensions whose date has passed.
- The public name is now first name plus the first letter of the surname (or the business name); it follows a rename.

All automated tests pass (246 web, 106 app, 21 in the shared packages, 373 in total); typecheck, lint and the Android bundle build are clean. Report: `Reports/Registration-Setup-Test-Report.xlsx`. Deployment steps: `docs/deployment.md`. A review of the whole branch is still to come.

The back office is in German and English: the language comes from the `admin-lang` cookie, else the browser language, and a button in the header switches it.

Nothing has been checked on a phone or in a browser yet.

### Pick up here

1. **Owner:** add the GitHub secrets `NEON_AUTH_BASE_URL` and `NEON_AUTH_COOKIE_SECRET` to this repository, so CI can run the web tests.
2. **Owner:** create the Vercel project (root `apps/web`) and add the environment variables, as in `docs/deployment.md`.
3. **Before this branch ships:** add `CRON_SECRET` on Vercel, and run `pnpm db:migrate` (migration `0008`) on any real database. The dev database is already migrated.
4. **Phone checks of every screen** on the development build, against the preview deployment, and the back office screens in a browser. The "Not yet done (phone)" rows in the report's Other Checks sheet are the list. For the new flow:
   1. Sign up with names, address, a picture and the "I want to offer services" tick; confirm the code.
   2. Open My service profile: fill the page, watch the fields save, check the keyboard never hides a field.
   3. Add a service and upload its document; press Publish and read the list of what is missing.
   4. Approve the document in the back office; check the email, the banner, the Share sheet and the dot on the Account tab.
   5. Check the home nudge and that it can be dismissed.
5. **Whole-branch review**, then owner review of the pull request, then merge.

### Test accounts (dev branch only)

`pnpm db:seed:test-users` creates customers and published providers from `packages/domain/seed-data/test-users.json`. Each person has `firstName` and `lastName` (and an optional address); there is no display name any more, the public name is built from the names. The file on this PC has been converted to this shape. That file is not in git (the repository is public); it lives on this PC only. A fresh clone starts from `test-users.example.json` (one customer, one provider): copy it to `test-users.json` and edit. The password is in the file; emails are created verified. Seeds refuse to run anywhere but the dev branch.

## Known gaps

- Refine's own button labels (Save, Create, Edit, Delete) are still English in the back office.
- Push notifications come with bookings; until then the banner and the email are the only signals.
- Small parked points from the reviews of the registration work are listed in the "Open Items" sheet of `Reports/Registration-Setup-Test-Report.xlsx` (for example: lifting a suspension on a user who is not suspended still sends "published again"; end dates in emails use the server time zone; the cron sends its emails one by one).
- No thumbnail sizes: the photo grid and the cards load full-size images.
- Documents over 4.5 MB cannot be uploaded through Vercel; the fix is to upload straight from the phone to storage.
- No "Delete my account" in the app (GDPR erasure and data export come later).
- No security scan of the whole project yet (row-level security, Next.js routes, Vercel settings); needed before launch.
- Placeholder graphics (app icon, splash, home page pictures) are still to be replaced.
- The legal pages (Impressum, Datenschutz, AGB, Ranking) are records that staff must write and publish in the back office.
- Before South Africa (not needed for Germany): the website footer links to the German legal pages `/impressum` and `/datenschutz` directly, and the website language switch shows only one other language, so it assumes exactly two (the back office switch does the same). Both get fixed with the South Africa work.
