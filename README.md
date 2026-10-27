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

Stage 1 is built on branch `stage-1`: database with row-level security, login (Neon Auth), the app API, photo and document storage, the translate button, document review, the staff back office under `/admin`, the website, the phone app and the seeds. A final review of the whole branch found 3 important and 10 minor points; all important ones and 8 minor ones are fixed, the other 2 wait for the South Africa work (see Known gaps). All automated tests pass (204 web, 85 app, 16 in the shared packages, 305 in total); typecheck and lint are clean. Report: `Reports/Stage-1-Test-Report.xlsx`. Deployment steps: `docs/deployment.md`.

Nothing has been checked on a phone or in a browser yet.

### Pick up here

1. **Owner:** add the GitHub secrets `NEON_AUTH_BASE_URL` and `NEON_AUTH_COOKIE_SECRET` to this repository, so CI can run the web tests.
2. **Owner:** create the Vercel project (root `apps/web`) and add the environment variables, as in `docs/deployment.md`.
3. **Phone checks of every screen** on the development build, against the preview deployment, and the back office screens in a browser. The "Not yet done (phone)" rows in the report's Other Checks sheet are the list.
4. **Owner review of the pull request**, then merge. The final review of the whole branch is done and its findings are fixed.

### Test accounts (dev branch only)

`pnpm db:seed:test-users` creates customers and published providers from `packages/domain/seed-data/test-users.json`. That file is not in git (the repository is public); it lives on this PC only. A fresh clone starts from `test-users.example.json` (one customer, one provider): copy it to `test-users.json` and edit. The password is in the file; emails are created verified. Seeds refuse to run anywhere but the dev branch.

## Known gaps

- Suspensions do not expire by themselves: the end date is informational and a suspension stays in force until a staff member lifts it. Automatic expiry is a Stage 2 job. A user suspended before having a provider profile is blocked from publishing even after the end date, and the back office shows no "lift" hint for them; lift the suspension on the user.
- No thumbnail sizes: the photo grid and the cards load full-size images.
- Documents over 4.5 MB cannot be uploaded through Vercel; the fix is to upload straight from the phone to storage.
- No "Delete my account" in the app (GDPR erasure and data export come later).
- No security scan of the whole project yet (row-level security, Next.js routes, Vercel settings); needed before launch.
- Placeholder graphics (app icon, splash, home page pictures) are still to be replaced.
- The legal pages (Impressum, Datenschutz, AGB, Ranking) are records that staff must write and publish in the back office.
- Before South Africa (not needed for Germany): the website footer links to the German legal pages `/impressum` and `/datenschutz` directly, and the website language switch shows only one other language, so it assumes exactly two. Both get fixed with the South Africa work.
