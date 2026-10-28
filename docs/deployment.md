# Deployment

How KANDO goes live. Nothing here has been done yet except the Neon dev branch. The owner runs the steps marked "owner".

## Pieces

- **Website, back office and API:** one Next.js app in `apps/web`, on Vercel, region `fra1` (Frankfurt; set in `apps/web/vercel.json`).
- **Daily check:** Vercel Cron (`crons` in `apps/web/vercel.json`) calls `/api/cron/suspensions` at 06:00 UTC with `Authorization: Bearer $CRON_SECRET`; it ends suspensions whose date has passed and sends the "published again" email. Vercel runs crons on the Production deployment only, so `CRON_SECRET` is needed for Production (Preview never runs the check).
- **Database, login and files:** Neon project `SkillWeb` in AWS Frankfurt (Postgres, Neon Auth, Object Storage).
- **Branches:** `kando-dev` exists now (endpoint `ep-steep-scene-b9p4f2v6`). `kando-main` is created at cutover. The old `main` and `dev` branches belong to the old Payload app and stay untouched until then.

## Vercel project (owner)

1. In Vercel, import the GitHub repository KANDO as a new project.
2. Set **Root Directory** to `apps/web`. Leave the framework on Next.js. Install command: `pnpm i` (Vercel reads the workspace from the repository root).
3. Add the environment variables below. Production gets the `kando-main` values, Preview gets the `kando-dev` values.
4. Hobby is not allowed for commercial use: switch to Pro before launch.
5. Deploy. Every pull request then gets a preview deployment, which the phone's development build can point at.

## Environment variables

Secret means: never in git, never in a `NEXT_PUBLIC_` variable, mark it Sensitive in Vercel.

| Variable | Secret | Used by | What it is |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | web, seeds | Pooled Neon connection string (the app at runtime). |
| `DATABASE_URL_UNPOOLED` | yes | migrations | Direct Neon connection string for `pnpm db:migrate`. |
| `NEON_BRANCH` | no | seeds, guards | Name of the branch in use (`kando-dev` or `kando-main`). |
| `DATABASE_URL_TEST` | no | tests only | Docker test database, default `postgres://postgres:postgres@localhost:5433/kando`. Never set on Vercel. |
| `NEON_AUTH_BASE_URL` | no | web, app, tests | Neon Auth address of the branch. |
| `NEON_AUTH_COOKIE_SECRET` | yes | web | Signs the login cookie. |
| `AWS_ACCESS_KEY_ID` | yes | web | Object storage access key. |
| `AWS_SECRET_ACCESS_KEY` | yes | web | Object storage secret key. |
| `AWS_REGION` | no | web | Object storage region. |
| `AWS_ENDPOINT` | no | web | Object storage endpoint. |
| `MEDIA_BUCKET` | no | web | Public photo bucket name. |
| `DOCUMENTS_BUCKET` | no | web | Private documents bucket name. |
| `OPENROUTER_API_KEY` | yes | web | Translate button. Without it the original texts are shown. |
| `TRANSLATE_MODEL` | no | web | Model used for translation. |
| `TRANSLATE_LIMIT_PER_HOUR` | no | web | Translate calls allowed per user or visitor per hour (default 30). |
| `TRANSLATE_TIMEOUT_MS` | no | web | Translate time limit (default 12000). |
| `RESEND_API_KEY` | yes | web | Approval, rejection, suspension and "profile is live" emails. Required in production: without it no email is sent, only one line is logged. |
| `CRON_SECRET` | yes | cron route | Vercel sends it as `Authorization: Bearer` to the daily check that ends suspensions (06:00 UTC, `/api/cron/suspensions`). Without it the route answers 401. Production only (crons do not run on Preview). |
| `NEXT_PUBLIC_SERVER_URL` | no | web | Public address of the site (links, sitemaps, canonical). |
| `VERCEL_PROJECT_PRODUCTION_URL` | no | web | Set by Vercel itself; do not add it by hand. |
| `ALLOW_PRODUCTION` | no | seeds only | Never set on Vercel. See Seeds. |
| `NEON_DEV_ENDPOINT_ID` | no | seeds only (optional) | The dev branch's endpoint id, only if `kando-dev` is recreated and gets a new one. Empty or unset means `ep-steep-scene-b9p4f2v6`. Never set on Vercel. |

## First staff account (owner)

Staff roles are set in the database, never through the app. To make the first Administrator: sign up in the app with the email you want to use, confirm the code, then run against that branch's database:

```sql
UPDATE users SET staff_role = 'admin' WHERE email = 'you@example.com';
```

Further staff accounts are created the same way; the Administrator can change roles in the back office afterwards. For the browser checks on `kando-dev`, the seeded customer `kunde.berlin@example.com` can be made Administrator with the same statement.

## Neon Auth: trusted domains

Login only works from origins the branch trusts. Add each one on the branch:

```
neon neon-auth domain add <origin>
```

`https://skillweb.space` is already added on `kando-dev`. Add the preview address and, at cutover, the production address on `kando-main`.

## Deleting an account

`DELETE /app-api/v1/me` runs on the owner connection (the app role may not delete from several tables), so it needs no setting of its own. It also deletes the person's rows in the `neon_auth` schema (every table with a foreign key to the user, the pending codes `<type>-otp-<email>` and the bare email, then the user); the database owner role must be allowed to write there. Migration `0009` adds `pending_object_deletes` (no access for the app role): run `pnpm db:migrate` (owner) on `kando-dev` and on `kando-main` before this ships. The keys of the person's files are stored there in the delete transaction, the objects are removed after the commit, and the daily cron (`/api/cron/suspensions`) retries what is left (200 even when storage is down). Before the first real use, try it once on a throw-away account on the `kando-dev` branch and check that the person is gone from the `neon_auth` tables.

## Exporting an account

`GET /app-api/v1/me/export` (JSON) and `?format=csv` (CSV) need no setting. Document and file links in the export are signed for 5 minutes with the storage keys, so the storage variables above must work on the server. The support address shown in the app error texts is `info@skillweb.space`.

## Neon Auth: confirmed emails

The app API refuses every account whose email is not confirmed yet (answer 403 `EMAIL_NOT_VERIFIED`), so nobody can use someone else's email address. On top of that, Neon Auth's own setting "Require email verification" may also be turned on for `kando-main`; then an unconfirmed account cannot even sign in. The app handles both: it asks for the code that was emailed.

## Database

- `neon deploy` (reads `neon.ts` in the repository root) applies the Neon settings, including Auth, to a branch.
- `pnpm db:migrate` changes the database schema. Run it against production only when the owner says so, with `DATABASE_URL_UNPOOLED` pointing at the target branch. Take a Neon branch of production first.
- Migration `0008` (registration and provider setup) renames and drops columns: `users.name` becomes `first_name`, `last_name` and a private address; `providers.display_name`, `providers.suspended` and `providers.photo_id` are dropped (`suspended_until` replaces `suspended`); old `profile` photos are deleted (the picture now belongs to the person; the deleted photos' objects stay in the bucket as orphans, which is harmless and they can be removed by hand). Nobody uses the app yet, so nothing is preserved. Run it with `pnpm db:migrate` (it applies the row-level security afterwards); dev is already migrated. On any real database: Neon branch first, then migrate.
- Every migration that creates tables must end with the row-level security statements for them (see the design, section on security).

## Cutover: preparing `kando-main`

Proposal, not yet agreed: the owner decides when and whether.

1. Create `kando-main` in the `SkillWeb` project (from `kando-dev` without data, or empty).
2. Run `neon deploy` on it, then `pnpm db:migrate` against it (owner instruction).
3. Import postcodes (`pnpm db:import:postcodes`) and categories (`$env:ALLOW_PRODUCTION='1'; pnpm db:seed:categories` in PowerShell, `ALLOW_PRODUCTION=1 pnpm db:seed:categories` in bash; the categories seed refuses any database but the dev one without it). Test accounts and placeholder photos are never seeded on `kando-main`.
4. Real users and providers from the old database: none today (the old production database holds only test data), so nothing is imported. If real users exist before the cutover, a migration has to be designed first.
5. Create the buckets and keys, set the Production variables in Vercel (including `RESEND_API_KEY`), add the production domain as trusted, and decide whether to turn on "Require email verification" in Neon Auth (see above).
6. Point the domain at the new Vercel project.

## Retiring the old branches after cutover

Proposal, not yet agreed: the owner decides when and whether.

1. Keep the old `main` (read-only, no writes) as a fallback.
2. When the owner is satisfied that the new site runs cleanly, take a final Neon branch of old `main` named `old-main-final`, then delete the old `dev` branch and the old `main` branch.
3. Archive the old repository `skill-web`.

## Seeds

There are three seeds. Each one checks two things: `NEON_BRANCH` names a dev branch (`kando-dev` or `dev`) and `DATABASE_URL` points at the dev endpoint. They print the database host before they start.

- `pnpm db:seed:categories` (also `pnpm db:seed`; in `packages/db`): the 14 categories. Anywhere but the dev branch only with `ALLOW_PRODUCTION=1` set (PowerShell: `$env:ALLOW_PRODUCTION='1'`; needed once at cutover, step 3).
- `pnpm db:seed:test-users` (in `packages/domain`): customers and published providers, all verified. Each person has `firstName` and `lastName` (no display name; the public name is built from the names). The account list and password are in the git-ignored `packages/domain/seed-data/test-users.json` (`test-users.example.json` is the committed starter). Dev branch only, no way around it. A run that stopped half-way can simply be run again.
- `pnpm db:seed:placeholder-photos` (in `packages/domain`): a generated photo for every published provider without one. Anywhere but the dev branch only with `ALLOW_PRODUCTION=1` and a typed `yes`.

## CI

GitHub Actions (`.github/workflows/ci.yml`) needs two repository secrets, `NEON_AUTH_BASE_URL` and `NEON_AUTH_COOKIE_SECRET`. Owner: add them under Settings, Secrets and variables, Actions. Not done yet.
