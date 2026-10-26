# Deployment

How KANDO goes live. Nothing here has been done yet except the Neon dev branch. The owner runs the steps marked "owner".

## Pieces

- **Website, back office and API:** one Next.js app in `apps/web`, on Vercel, region `fra1` (Frankfurt; set in `apps/web/vercel.json`).
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
| `RESEND_API_KEY` | yes | web | Approval and rejection emails. Without it emails are only logged. |
| `NEXT_PUBLIC_SERVER_URL` | no | web | Public address of the site (links, sitemaps, canonical). |
| `VERCEL_PROJECT_PRODUCTION_URL` | no | web | Set by Vercel itself; do not add it by hand. |
| `ALLOW_PRODUCTION` | no | seeds only | Never set on Vercel. See Seeds. |

## Neon Auth: trusted domains

Login only works from origins the branch trusts. Add each one on the branch:

```
neon neon-auth domain add <origin>
```

`https://skillweb.space` is already added on `kando-dev`. Add the preview address and, at cutover, the production address on `kando-main`.

## Database

- `neon deploy` (reads `neon.ts` in the repository root) applies the Neon settings, including Auth, to a branch.
- `pnpm db:migrate` changes the database schema. Run it against production only when the owner says so, with `DATABASE_URL_UNPOOLED` pointing at the target branch. Take a Neon branch of production first.
- Every migration that creates tables must end with the row-level security statements for them (see the design, section on security).

## Cutover: preparing `kando-main`

1. Create `kando-main` in the `SkillWeb` project (from `kando-dev` without data, or empty).
2. Run `neon deploy` on it, then `pnpm db:migrate` against it (owner instruction).
3. Import postcodes (`pnpm db:import:postcodes`) and categories (`pnpm db:seed:categories`). Test accounts and placeholder photos are never seeded on `kando-main`.
4. Import real users and providers from the old database (not part of Stage 1).
5. Create the buckets and keys, set the Production variables in Vercel, add the production domain as trusted.
6. Point the domain at the new Vercel project.

## Retiring the old branches after cutover

1. Keep the old `main` (read-only, no writes) as a fallback.
2. When the owner is satisfied that the new site runs cleanly, take a final Neon branch of old `main` named `old-main-final`, then delete the old `dev` branch and the old `main` branch.
3. Archive the old repository `skill-web`.

## Seeds

All four seeds refuse to run unless `NEON_BRANCH` is a dev branch and `DATABASE_URL` points at the dev endpoint.

- `pnpm db:seed` (categories, in `packages/db`)
- `pnpm db:seed:test-users` (in `packages/domain`): customers and published providers, all verified, password `TestPass123`. The account list is in `packages/domain/src/seed/test-users.ts`.
- `pnpm db:seed:placeholder-photos` (in `packages/domain`): a generated photo for every published provider without one.

## CI

GitHub Actions (`.github/workflows/ci.yml`) needs two repository secrets, `NEON_AUTH_BASE_URL` and `NEON_AUTH_COOKIE_SECRET`. Owner: add them under Settings, Secrets and variables, Actions. Not done yet.
