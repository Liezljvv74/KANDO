# Stage 1: Foundation and Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new monorepo (this repository, KANDO) on which every feature of today's SkillWeb works without Payload: accounts, provider profiles with services, references, photos and documents, search, public provider pages, the translate button, and a staff back office with Administrator and Reviewer roles.

**Architecture:** One pnpm workspace. `apps/web` is a Next.js 16 App Router app serving the website, the `/admin` back office (Refine with Ant Design) and the JSON API the phone app calls under `/app-api/v1/*` (same paths as today, so the app changes little). `packages/db` owns the Drizzle schema, migrations and the row-level-security statements; `packages/domain` holds the business modules used by route handlers; `packages/contract` holds the Zod schemas every surface validates against; `packages/i18n` holds the one German/English text catalogue. Identity is Neon Auth (Managed Better Auth); app requests run in a Postgres transaction as the restricted role `app_user` with the caller's id in a session setting, exactly as the old repository did. `apps/mobile` is the existing Expo app moved over with a new API client.

**Tech Stack:** Node 24, pnpm 10 workspaces (`node-linker=hoisted` for Expo), TypeScript strict. Next.js 16, React 19, `@neondatabase/auth` (`createNeonAuth` from `@neondatabase/auth/next/server`), Drizzle ORM with `pg`, Zod, Refine (`@refinedev/core`, `@refinedev/nextjs-router`, `@refinedev/antd`), `sharp`, `tinyld`, Resend, Vitest 4 (web, against Postgres 17 + PostGIS in Docker), Jest with jest-expo (mobile), GitHub Actions, Expo SDK 58 with EAS. Pin exact versions at install time; current stable of each.

**Spec:** `docs/specs/2026-10-26-kando-foundation-design.md` (sections 2.1 goals 1, 5 (documents only), 7, 8, 9; 4; 4.1; 4.2; 5; 6 stage 1; 7).

## Global Constraints

- Every change through a pull request on a branch off `main`; the owner merges. Commit messages plain; no AI co-author or "Generated with" lines anywhere. No competitor names anywhere.
- Every user-facing text exists in German and English, in `packages/i18n` only; a test fails when the key sets differ.
- Every table with user data has a row-level security policy and an isolation test proving user A cannot read or change user B's rows; the test that every schema table is classified (private, public-owned, insert-only, public reference or staff-only) fails the build otherwise.
- App requests (`/app-api/*`) run through `appRequest()` (Task 3): session checked, one transaction as role `app_user` with `app.user_id` set, commit on success, rollback on error. A test fails the build when a file under `app/app-api/` exports a handler not built with it.
- Staff requests (`/api/admin/*`) run on the owner connection only after `requireStaff()` confirmed the session and the role.
- Country-ready rules (spec section 5): postcodes keyed by `(country, code)`; every money amount next to a `currency`; no `=== 'en' ? 'en' : 'de'`-style two-language switches (language is a `Lang` union from `packages/i18n`, currently `'de' | 'en'`); verification requirement codes neutral; no "Frankfurt", "DSGVO" or "EUR" in shared components outside texts.
- Primary keys are `uuid` (`gen_random_uuid()`), except `users.id` which is the Neon Auth user id (`text`).
- Product name "SkillWeb" appears only as `brand.name` in the text catalogue and `app.json`'s `name`.
- Data stays in Frankfurt. Neon: the **existing project `SkillWeb`** (id `withered-wave-83432300`, AWS Europe Central 1, Frankfurt), no new project. Stage 1 works on a **new branch `kando-dev`** created from `main` with its `public` schema dropped and recreated once (Task 2), so the new schema starts empty; the old branches `main` and `dev` keep serving the old repository until cutover. At cutover (Stage 4) a `kando-main` branch is prepared the same way and becomes production. Neon Auth is enabled on `kando-dev` (Task 3). Vercel region `fra1`; Neon Object Storage buckets `media` (public read) and `documents` (private) in the same project; Resend EU.
- Security carry-overs from the old repo: an upload body is read after the session check and before the transaction; photos are re-encoded with `sharp` to at most 1600 px; documents are PDF only, at most 4.5 MB; one pending check per document; publishing a provider needs a profile photo; a service is hidden until its required documents are approved; a published profile with no offerable service is hidden from search and has no public page.
- Session: Neon Auth defaults (7-day session). Email verification and password reset use 6-digit codes (Email OTP) typed in the app; no link-based flows.

## Review Focus

1. A user whose Neon Auth account exists but who has never hit the API (no `users` row yet) calls `/app-api/v1/me`: expected a row is created on first contact, language from the request, no 500. Test in Task 3 ("first contact creates the users row").
2. A request with a stale or forged session cookie: expected 401 with no transaction opened and no `users` write. Test in Task 3 ("a forged cookie is 401 and touches nothing").
3. Two providers publish with the same display name: expected distinct public names and slugs, the second gets a suffix, and renames keep the slug stable. Test in Task 5 ("public name and slug are unique and stable").
4. A search from a postcode on the edge of a provider's radius: expected included at exactly the radius, excluded one km beyond, remote providers always included; distances rounded to whole km, minimum 1. Test in Task 7 ("radius edge and remote providers").
5. A Reviewer tries an Administrator-only action (change a staff role, edit categories): expected 403 and no change. Test in Task 10 ("Reviewer cannot do Administrator actions").

---

### Task 1: Monorepo scaffold, CI and the Docker test database

**Files:**
- Create: `package.json` (root, `private`, workspaces, scripts `typecheck`, `lint`, `test`, `db:*`), `pnpm-workspace.yaml` (`apps/*`, `packages/*`), `.npmrc` (`node-linker=hoisted`), `.nvmrc` (`24`), `tsconfig.base.json` (strict, `moduleResolution: bundler`, paths none), `.editorconfig`, `.prettierrc`, `eslint.config.mjs` (typescript-eslint, flat config, shared), `.gitignore` (node_modules, .next, .expo, dist, .env*, Marketing/, Reports/~*, .superpowers/)
- Create: `docker-compose.yml` (service `db`: image `postgis/postgis:17-3.5`, port 5433, database `kando`, user `postgres`, password `postgres`), `.env.example` (every variable the stages need, see step 3)
- Create: `.github/workflows/ci.yml`
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/next.config.ts`, `apps/web/app/layout.tsx`, `apps/web/app/page.tsx` (placeholder "SkillWeb"), `apps/web/vitest.config.ts` (`tests/**/*.int.spec.ts`, `globalSetup` from Task 2), `apps/web/tests/smoke.int.spec.ts`
- Create: `packages/{db,domain,contract,i18n}/package.json` and `src/index.ts` placeholders with a `tsconfig.json` extending the base
- Modify: `README.md` (how to run: `docker compose up -d db`, `pnpm i`, `pnpm test`, `pnpm --filter web dev`)

**Interfaces:**
- Produces: package names `@kando/db`, `@kando/domain`, `@kando/contract`, `@kando/i18n`, app names `web`, `mobile`; root scripts `pnpm typecheck` (all packages `tsc --noEmit`), `pnpm lint`, `pnpm test` (web vitest + mobile jest), `pnpm db:migrate`, `pnpm db:generate`, `pnpm db:seed` (filled in later tasks).
- Produces: env names: `DATABASE_URL` (pooled), `DATABASE_URL_UNPOOLED`, `DATABASE_URL_TEST` (Docker, default `postgres://postgres:postgres@localhost:5433/kando`), `NEON_BRANCH` (`dev` or `main`), `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET`, `NEXT_PUBLIC_SERVER_URL`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_ENDPOINT`, `MEDIA_BUCKET`, `DOCUMENTS_BUCKET`, `RESEND_API_KEY`, `OPENROUTER_API_KEY`, `TRANSLATE_MODEL`, `TRANSLATE_LIMIT_PER_HOUR`, `TRANSLATE_TIMEOUT_MS`.

- [ ] **Step 1: Write the failing smoke test** `apps/web/tests/smoke.int.spec.ts`: `it('connects to the test database and sees PostGIS')` asserts `SELECT postgis_version()` returns a string, using `pg` and `DATABASE_URL_TEST`.
- [ ] **Step 2: Run `pnpm --filter web test`** → FAIL (no workspace, no database).
- [ ] **Step 3: Create the files above.** CI workflow: on `pull_request` and `push` to `main`; a `postgis/postgis:17-3.5` service container; steps: checkout, pnpm 10 via `pnpm/action-setup`, Node 24 with pnpm cache, `pnpm i --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test` with `DATABASE_URL_TEST` pointed at the service; a second job `mobile` runs `pnpm --filter mobile test` and `tsc`.
- [ ] **Step 4: `docker compose up -d db`, `pnpm i`, `pnpm --filter web test`** → PASS; `pnpm typecheck` and `pnpm lint` clean.
- [ ] **Step 5: Commit** `chore: monorepo scaffold, CI, Docker test database`, open the pull request `stage-1/scaffold`.

---

### Task 2: Database package: connection, migrations, row-level security, reference tables, postcodes

**Files:**
- Create: `packages/db/src/client.ts`, `packages/db/src/schema/index.ts`, `packages/db/src/schema/reference.ts` (countries, currencies, postcodes, categories, category_texts), `packages/db/src/rls.ts`, `packages/db/src/migrate.ts`, `packages/db/src/as-user.ts`, `packages/db/drizzle.config.ts`, `packages/db/migrations/*` (generated), `packages/db/data/postcodes-de.tsv` (copied from the old repo's `data/postcodes-de.tsv`), `packages/db/src/postcodes.ts`, `packages/db/src/test/setup.ts` (vitest global setup: migrate the test database, apply RLS)
- Test: `apps/web/tests/db-migrations.int.spec.ts`, `apps/web/tests/rls.int.spec.ts`, `apps/web/tests/postcodes.int.spec.ts`

**Interfaces:**
- Produces: `db` (Drizzle instance over a `pg.Pool` from `DATABASE_URL`, or `DATABASE_URL_TEST` when `NODE_ENV === 'test'`), `pool`.
- Produces: `migrate(): Promise<void>` runs Drizzle migrations from `packages/db/migrations` then `applyRls()`; `applyRls(): Promise<void>` runs `rlsStatements()` idempotently.
- Produces: `PRIVATE_TABLES: Record<string, string>`, `PUBLIC_OWNED_TABLES: Record<string, { owner: string; publicRead: string }>`, `INSERT_ONLY_TABLES: string[]`, `PUBLIC_REFERENCE_TABLES: string[]` (readable by `app_user`, written only by staff), `STAFF_ONLY_TABLES: string[]`; `rlsStatements(): string[]` ported from the old `src/rls/index.ts` with `app_current_user_id()` returning `text` (nullif of `current_setting('app.user_id', true)`); every table in the Drizzle schema must appear in exactly one map (`classifyTables(): { unclassified: string[]; duplicated: string[] }`).
- Produces: `asUser<T>(userId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T>` opens a transaction, `SET LOCAL ROLE app_user`, `SELECT set_config('app.user_id', $1, true)`, runs `fn`, commits or rolls back. `Tx` is Drizzle's transaction type.
- Produces: schema `countries(code text pk, name_de, name_en, postcode_pattern text)`, `currencies(code text pk, minor_units int)`, `postcodes(country text fk, code text, place text, state text, location geometry(Point,4326) not null; pk (country, code); GiST index on location::geography)`, `categories(id uuid pk, slug text unique, country text fk default 'DE', sort int, required_documents text[] default '{}')`, `category_texts(category_id fk, lang text, name text; pk (category_id, lang))`.
- Produces: `isPostcode(country: string, code: string): Promise<boolean>` (pattern from `countries.postcode_pattern`, `^\d{5}$` for DE), `lookupPostcode(country, code): Promise<{ code, place, state, lat, lng } | null>`, `importPostcodes(country: 'DE', file: string): Promise<number>` (upsert by country and code), `distanceKm(a, b): number` (haversine, 6371 km).

- [ ] **Step 1: Write the failing tests.** `db-migrations`: `it('migrates an empty database and classifies every table')` (drops and recreates schema `public` on the test DB, runs `migrate()`, asserts `classifyTables()` is `{ unclassified: [], duplicated: [] }` and that `app_user` exists). `rls`: `it('app_user cannot read a private table row of another user')` using a temporary private table registered in a test-only map (or `users` once Task 3 lands; use a `rls_probe` private table created and dropped in the test), `it('public reference tables are readable by app_user and not writable')`. `postcodes`: `it('imports the German file and looks up 01053 Dresden')`, `it('rejects a four-digit German code and an unknown one')`, `it('Berlin to Munich is about 504 km')`.
- [ ] **Step 2: Run them** → FAIL.
- [ ] **Step 3: Implement.** Drizzle config with `dialect: 'postgresql'`, schema files, `pnpm db:generate` for the first migration (includes `CREATE EXTENSION IF NOT EXISTS postgis` and the GiST index as custom SQL), `rls.ts` port, `as-user.ts`, `postcodes.ts` (stream the TSV; columns `code place state lat lng`), the vitest global setup that migrates the test DB once per run. Then the Neon branch: `neon branches create --name kando-dev --parent main` in project `withered-wave-83432300` (owner may do this in the console instead); on that branch run once, by hand and only there, `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` (it is a copy of test data; nothing is lost), put its pooled and direct connection strings into `.env` as `DATABASE_URL` and `DATABASE_URL_UNPOOLED` with `NEON_BRANCH=kando-dev`, and run `pnpm db:migrate`. Record the branch id in the task report.
- [ ] **Step 4: Run** → PASS; typecheck and lint clean.
- [ ] **Step 5: Commit** `feat(db): drizzle schema, migrations, row-level security, postcodes`.

---

### Task 3: Neon Auth, the users table and the app request wrapper

**Files:**
- Create: `neon.ts` (`defineConfig({ auth: true })`), `apps/web/lib/auth/server.ts` (`createNeonAuth({ baseUrl, cookies: { secret } })`), `apps/web/app/api/auth/[...path]/route.ts` (`export const { GET, POST, PUT, DELETE, PATCH } = auth.handler()`), `apps/web/proxy.ts` (`auth.middleware({ loginUrl: '/admin/sign-in' })` with `matcher: ['/admin/:path*']`)
- Create: `packages/db/src/schema/users.ts`, `packages/domain/src/app-request.ts`, `packages/domain/src/users.ts`, `apps/web/app/app-api/v1/me/route.ts`
- Test: `apps/web/tests/auth-cookie-flow.int.spec.ts` (runs only when `NEON_AUTH_BASE_URL` is set; skipped with a printed reason otherwise), `apps/web/tests/app-request.int.spec.ts`, `apps/web/tests/app-endpoints-wrapped.int.spec.ts`

**Interfaces:**
- Produces: schema `users(id text pk = Neon Auth user id, email text unique, language text default 'de', name text, is_provider bool default false, staff_role text null check in ('admin','reviewer'), suspended_until timestamptz null, suspended_reason text null, created_at, updated_at)`; `users` is in `PRIVATE_TABLES` with `id = app_current_user_id()`; column-level: `staff_role`, `suspended_*` only writable by staff (revoke UPDATE on those columns from `app_user`).
- Produces: `appRequest(opts: { auth: 'required' | 'optional'; maxBodyBytes?: number }, handler: (ctx: { tx: Tx; user: SessionUser | null; request: Request; params: Record<string, string> }) => Promise<Response>): RouteHandler` where `SessionUser = { id: string; email: string; language: Lang; isProvider: boolean }`. Behaviour: read the session with `auth.getSession()` (request cookies); `required` without a session → 401 `{ error: 'Unauthorized' }`; on first contact insert the `users` row (`ensureUser(session)`, owner connection, language from `Accept-Language` or `?lang`, default `de`); then `asUser(user.id, …)`; a thrown error → rollback and 500 `{ error: 'Server error' }` logged with a request id; a returned Response commits.
- Produces: `requireStaff(role: 'admin' | 'reviewer' | 'any'): Promise<StaffUser>` for `/api/admin/*` (throws a 403 Response when the session lacks the role; Reviewer passes `'reviewer'` and `'any'`, Administrator passes everything).
- Produces: `GET /app-api/v1/me` → `{ id, email, language, isProvider, staffRole }`; `PATCH /app-api/v1/me` body `{ language?: Lang; name?: string }`.
- Decision gate (the auth spike): the phone app will call the same Better Auth REST endpoints a browser does (`POST /api/auth/sign-up/email`, `POST /api/auth/sign-in/email`, `POST /api/auth/sign-out`, `GET /api/auth/get-session`, `POST /api/auth/email-otp/send-verification-otp`, `POST /api/auth/email-otp/verify-email`, `POST /api/auth/forget-password/email-otp`, `POST /api/auth/email-otp/reset-password`) and keep the `set-cookie` value in SecureStore, sending it back as a `Cookie` header. The test in step 1 proves this works end to end against the Neon dev branch. If `set-cookie` is not exposed or `auth.getSession()` does not accept the forwarded cookie, stop and report BLOCKED with the exact response; the fallback (controller decides) is a thin `/app-api/v1/auth/*` proxy that calls `auth.signUp.email()` / `auth.signIn.email()` server-side and returns the cookie value in the JSON body.

- [ ] **Step 1: Write the failing tests.** `auth-cookie-flow`: `it('signs up by REST, captures the cookie, and the cookie authenticates /app-api/v1/me')` (unique email `kando-test-<stamp>@test.skilled.invalid`, password `TestPass123!`; asserts `set-cookie` present, then `GET /app-api/v1/me` with that `Cookie` header returns 200 and the email; cleanup: delete the `users` row; note the Neon Auth user stays on the dev branch). `app-request`: `it('first contact creates the users row')`, `it('a forged cookie is 401 and touches nothing')` (count of `users` unchanged), `it('required auth without a cookie is 401')`, `it('a handler error rolls back and returns 500')` (handler inserts a probe row then throws), `it('user A cannot read user B through the wrapper')`. `app-endpoints-wrapped`: `it('every route file under app/app-api exports handlers built with appRequest')` (reads the files, requires `appRequest(` for each exported method).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Enable Auth on the `kando-dev` branch of project `withered-wave-83432300` (`neon deploy` after `neon.ts`, targeting that branch; the owner adds its `NEON_AUTH_BASE_URL` and a generated `NEON_AUTH_COOKIE_SECRET` to `.env`; CI gets them as repository secrets for the auth test). Enable Email OTP on that branch. `appRequest`, `ensureUser`, `requireStaff`, the `me` route.
- [ ] **Step 4: Run** → PASS (auth test green locally against the dev branch; in CI only when the secrets exist).
- [ ] **Step 5: Commit** `feat(auth): Neon Auth, users table, app request wrapper, /me`.

---

### Task 4: Text catalogue and API contract packages

**Files:**
- Create: `packages/i18n/src/de.ts`, `packages/i18n/src/en.ts`, `packages/i18n/src/index.ts`, `packages/i18n/src/index.test.ts`
- Create: `packages/contract/src/common.ts`, `packages/contract/src/me.ts`, `packages/contract/src/categories.ts`, `packages/contract/src/providers.ts` (search item, search result, provider detail, translation texts), `packages/contract/src/my-profile.ts` (profile, service, reference, photo, document and their inputs), `packages/contract/src/admin.ts` (list query, user, document review), `packages/contract/src/index.ts`
- Test: `packages/contract/src/index.test.ts` (vitest in the package)

**Interfaces:**
- Produces: `type Lang = 'de' | 'en'`, `LANGS: readonly Lang[]`, `DEFAULT_LANG = 'de'`, `isLang(v: unknown): v is Lang`, `t(lang: Lang, key: Key, params?: Record<string, string | number>): string` with `{name}` placeholders, `Key = keyof typeof de`. Keys are merged from the old repo's `src/i18n/web.ts`, `src/i18n/home.ts`, `src/email/templates.ts` and `mobile/src/i18n/index.ts`, namespaced as today (`home.*`, `web.*`, `email.*`, `provider.*`, `search.*`, `auth.*`, `myProfile.*`, `admin.*`, `brand.name = 'SkillWeb'`). The home-page texts carry the 26 October wording (no Treuhand, Escrow, "garantiert").
- Produces: Zod schemas and inferred types with the same JSON shapes the old endpoints returned (read the old `mobile/src/api/*.ts` types): `MeSchema`, `CategorySchema` (`{ id, slug, name, requiredDocuments }`), `SearchItemSchema`, `SearchResultSchema` (`{ items, page, hasMore }`), `ProviderDetailSchema` (plus `translatable: boolean`), `TranslatableTextsSchema`, `MyProfileSchema`, `ServiceInputSchema` (`priceType: 'fixed' | 'hourly' | 'from' | 'on-request'`, `price` number with 2 decimals, `currency: 'EUR'`), `ReferenceInputSchema`, `DocumentSchema` (`requirement: string`, `status: 'pending' | 'approved' | 'rejected'`, `note`), `AdminListQuerySchema` (`page`, `pageSize` ≤ 100, `sort`, `filter` as a JSON string), `AdminUserSchema`, `DocumentReviewInputSchema` (`{ decision: 'approved' | 'rejected'; note?: string }`).
- Produces: `parseBody<T>(schema, request): Promise<T>` (400 `{ error: 'Invalid input', issues }` on failure) and `parseQuery` in `packages/contract/src/parse.ts`, used by every route.

- [ ] **Step 1: Write the failing tests.** i18n: `it('de and en have the same keys')`, `it('t replaces placeholders and falls back to the key when missing')`, `it('no text contains Treuhand, Escrow, garantiert or a competitor name')` (word list in the test). contract: `it('ServiceInputSchema rejects three decimals and negative prices')`, `it('AdminListQuerySchema caps pageSize at 100')`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** both packages.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: text catalogue and API contract packages`.

---

### Task 5: Provider profiles, services and references

**Files:**
- Create: `packages/db/src/schema/providers.ts` (providers, services, provider_references), `packages/domain/src/providers/{profile.ts,public-name.ts,eligibility.ts,slug.ts}`, `apps/web/app/app-api/v1/provider-profile/route.ts`, `.../provider-profile/publish/route.ts`, `.../provider-profile/unpublish/route.ts`, `.../services/route.ts`, `.../services/[id]/route.ts`, `.../references/route.ts`, `.../references/[id]/route.ts`
- Test: `apps/web/tests/provider-profile.int.spec.ts`, `apps/web/tests/services-references.int.spec.ts`, `apps/web/tests/public-name.int.spec.ts`, `apps/web/tests/publish-flow.int.spec.ts`

**Interfaces:**
- Consumes: `appRequest`, `asUser`, contract schemas, `lookupPostcode`.
- Produces: schema `providers(id uuid pk, owner_id text fk users unique, type 'private' | 'business', display_name, public_name, slug unique, bio, strengths, skills text[], experience, country text default 'DE', base_postcode, location geometry(Point,4326), service_radius_km int default 25 (1..200), works_remotely bool, impressum, status 'draft' | 'published', suspended bool default false, legal_status 'private' | 'kleinunternehmer' | 'business' null, vat_id null, photo_id uuid null, created_at, updated_at)`; `services(id uuid pk, provider_id fk, category_id fk, title, description, price_type, price numeric(10,2) null, currency text default 'EUR', sort int)`; `provider_references(id uuid pk, provider_id fk, client_name, description, year int null)`. RLS: `providers` public-owned (`owner_id = app_current_user_id()`; public read `status = 'published' AND suspended = false`), `services` and `provider_references` public-owned through the provider; columns `status`, `suspended`, `slug`, `public_name`, `location` set only by the domain (revoke direct UPDATE on them from `app_user`; the domain updates through a `SECURITY DEFINER` function `set_provider_state(...)` or via the owner connection inside the wrapper; builder's call, documented in the task report).
- Produces: `getMyProfile(tx, userId)`, `upsertMyProfile(tx, userId, input)`, `publish(tx, userId)` (requires a profile photo, a base postcode that resolves, at least one service; sets `public_name` and `slug` via `public-name.ts` rules ported from the old `src/marketplace/publicName.ts` and the slug rules in the old `ProviderProfiles.ts` incl. umlaut transliteration and a numeric suffix on collision), `unpublish(tx, userId)`, `listServices/addService/updateService/deleteService`, same for references (max 2 references as today), `offerableServiceIds(tx, providerId)` (services whose category's `required_documents` are all approved for the owner).
- Endpoints keep the old paths and JSON shapes; `GET /app-api/v1/provider-profile` returns `null` when none.

- [ ] **Step 1: Write the failing tests**, ported from the old specs of the same names: create, edit, publish with and without a photo (photo requirement is asserted once Task 6 lands; until then the test seeds `photo_id` directly), unknown postcode → 400 `{ error: 'Unknown postcode' }`, "public name and slug are unique and stable" (two profiles named "Tischlerei Nord": slugs `tischlerei-nord` and `tischlerei-nord-2`; a rename of the first keeps `tischlerei-nord`), services with `on-request` have no price, references capped at 2, user A cannot edit user B's service (403 or 404, never a change).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** schema, migration, RLS entries, domain, routes.
- [ ] **Step 4: Run** → PASS; `classifyTables` test still green.
- [ ] **Step 5: Commit** `feat: provider profiles, services and references`.

---

### Task 6: Files: photos, portfolio and documents

**Files:**
- Create: `packages/db/src/schema/files.ts` (photos, documents), `packages/domain/src/storage.ts` (S3 client for Neon Object Storage; `putObject`, `getSignedUrl`, `deleteObject`), `packages/domain/src/photos.ts` (sharp pipeline), `packages/domain/src/documents.ts`, routes `apps/web/app/app-api/v1/photos/route.ts`, `.../photos/[id]/route.ts`, `.../files/route.ts`, `.../files/[id]/route.ts`, `.../verifications/route.ts`
- Test: `apps/web/tests/provider-photos.int.spec.ts`, `apps/web/tests/private-files.int.spec.ts`, `apps/web/tests/verifications.int.spec.ts` (storage mocked with an in-memory `Storage` implementation injected through `packages/domain/src/storage.ts`'s `setStorageForTests()`)

**Interfaces:**
- Produces: schema `photos(id uuid pk, owner_id fk users, provider_id fk providers, kind 'profile' | 'portfolio', key text, width, height, alt text, sort int, created_at)` public-owned through the provider; `documents(id uuid pk, owner_id fk users, requirement text, key text (private bucket), status 'pending' | 'approved' | 'rejected' default 'pending', note text null, reviewed_by text null, reviewed_at null, created_at)` private; `providers.photo_id` references `photos`.
- Produces: `POST /app-api/v1/photos` (multipart, field `file`, `kind`; profile replaces the old one, portfolio max 12; re-encode to JPEG ≤ 1600 px; returns `{ id, url, width, height }`), `DELETE /app-api/v1/photos/[id]`, `POST /app-api/v1/files` (PDF ≤ 4.5 MB → private bucket, returns `{ id }`), `GET /app-api/v1/files/[id]` (signed URL for the owner only), `POST /app-api/v1/verifications` body `{ requirement, fileId }` (one pending per requirement; a failed insert deletes the uploaded object), `GET /app-api/v1/verifications` (the owner's documents with status and note). Requirement codes: `police-certificate`, `permit`.
- Produces: `photoUrl(key): string` (public bucket base URL), `eligibility` from Task 5 now reads `documents`.

- [ ] **Step 1: Write the failing tests**, ported: profile photo replace deletes the old object, portfolio limit 12, a non-image is 400, `GET /files/[id]` by another user is 404, one pending check per requirement (second POST → 409), a failed document submit removes the object, approving a document (direct SQL as staff in the test) makes the babysitting service offerable.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: photos, documents and verification uploads`.

---

### Task 7: Search, categories and the public provider endpoint

**Files:**
- Create: `packages/domain/src/search.ts`, `packages/domain/src/public-profile.ts`, `packages/domain/src/categories.ts`, routes `apps/web/app/app-api/v1/providers/route.ts`, `.../providers/[slug]/route.ts`, `.../categories/route.ts`
- Test: `apps/web/tests/search.int.spec.ts`, `apps/web/tests/provider-public.int.spec.ts`, `apps/web/tests/categories.int.spec.ts`

**Interfaces:**
- Produces: `search(tx, { category?, postcode?, q?, page = 1, lang, country = 'DE' }): Promise<SearchResult>` with `PAGE_SIZE = 20`, `MAX_CANDIDATES = 500`, `MAX_DISTANCE_M = 200_000`; on-site providers within their own `service_radius_km` of the origin, remote providers always; sort by distance then public name (`localeCompare` with the request language); distance rounded to whole km, minimum 1; `fromPrice` = minimum service price. Only `VISIBLE` providers: `status = 'published' AND suspended = false AND EXISTS offerable service`.
- Produces: `getPublicProfile(tx, slug, lang): Promise<ProviderDetail | null>` (same shape as the old `publicProfile.ts`, with `place` from the postcode table and `photoUrls`), `listCategories(tx, lang)` (sorted by `sort`, "Other services" last).
- Produces: `GET /app-api/v1/providers?category&postcode&q&page&lang`, `GET /app-api/v1/providers/[slug]?lang` (404 when not visible; adds `translatable` in Task 8), `GET /app-api/v1/categories?lang` (400 `Unknown language` otherwise). Auth optional on all three.

- [ ] **Step 1: Write the failing tests**, ported: "radius edge and remote providers" (provider in 10115 with radius 25 km; origins at exactly 25 km and at 26 km computed from fixture coordinates; a remote provider appears for any postcode), a draft or suspended provider never appears, a published provider without an offerable service is hidden, paging `hasMore`, category filter, `q` matches public name and skills, categories ordered with other-services last.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (PostGIS `ST_DWithin(location::geography, …)`, then filter by each provider's radius in SQL or memory as today). **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: search, categories and public provider endpoint`.

---

### Task 8: Translate module port

**Files:**
- Create: `packages/db/src/schema/translations.ts`, `packages/domain/src/translate.ts` (port of the old `src/marketplace/translate.ts` at commit `c2d244c` of the old repo: same functions, Drizzle instead of Payload), routes `apps/web/app/app-api/v1/providers/[slug]/translation/route.ts`
- Modify: `apps/web/app/app-api/v1/providers/[slug]/route.ts` (adds `translatable`)
- Test: `apps/web/tests/translate.int.spec.ts`, `apps/web/tests/provider-translation.int.spec.ts` (ported; fetch mocked; unique client keys; cleanup registered after each create)

**Interfaces:**
- Produces: schema `translations(id uuid, key text, lang text, text text; unique (key, lang))` and `translation_requests(id uuid, client_key text, created_at)` in `INSERT_ONLY_TABLES`; exports `textsOf`, `needsTranslation` (page-level detection, long-text check at 80 characters), `translateTexts`, `TranslationUnavailable`, `TRANSLATE_TIMEOUT_MS = 12_000`, `TRANSLATE_LIMIT_PER_HOUR = 30`, `DEFAULT_TRANSLATE_MODEL` (re-check the OpenRouter slug at build time, date in a comment), `clientKeyOf(user, request)` (`user:<id>` or `ip:<sha256(secret + ip) first 32 hex>`; secret = `NEON_AUTH_COOKIE_SECRET`), counter rows deleted after 24 h on the owner connection.

- [ ] **Step 1: Port the tests** (18 in `translate`, 8 in `provider-translation`) → FAIL. **Step 2: Port the module and routes.** **Step 3: Run** → PASS.
- [ ] **Step 4: Commit** `feat: translate button backend`.

---

### Task 9: Website: home, provider pages, legal pages, sitemaps

**Files:**
- Create: `packages/db/src/schema/pages.ts` (pages, page_texts), `packages/domain/src/pages.ts`, `apps/web/app/(site)/layout.tsx`, `apps/web/app/(site)/page.tsx`, `apps/web/app/(site)/[slug]/page.tsx`, `apps/web/app/(site)/providers/[slug]/page.tsx` (with `?translate=1` as in the old repo), `apps/web/app/(site)/providers-sitemap.xml/route.ts`, `apps/web/app/(site)/pages-sitemap.xml/route.ts`, `apps/web/app/robots.ts`, `apps/web/components/{footer,lang-switch,provider-card}.tsx`
- Test: `apps/web/tests/home-page.int.spec.ts`, `apps/web/tests/provider-page.int.spec.ts`, `apps/web/tests/pages.int.spec.ts`, `apps/web/tests/sitemaps.int.spec.ts`

**Interfaces:**
- Produces: schema `pages(id uuid, slug unique, published bool, kind 'page' | 'post', published_at null)`, `page_texts(page_id, lang, title, body_markdown; pk (page_id, lang))` in `PUBLIC_REFERENCE_TABLES`; `getPage(slug, lang)` falls back to `de`; body rendered from Markdown (a small, safe renderer; no raw HTML).
- Website language from `?lang=`; `<html lang>` follows it; `hreflang` alternates for every `Lang`; footer links `/impressum`, `/datenschutz`, `/agb`, `/ranking` with labels from the catalogue; the home page texts from `home.*`; provider page server-rendered with `generateMetadata`, `noindex` for `translate=1`, canonical unchanged; sitemaps list published pages and visible providers.

- [ ] **Step 1: Write the failing tests** (render the page components as the old tests did): home shows the headline and no forbidden words; provider page 404 for hidden providers, shows prices as `ab 80,00 €` (de) and `from €80.00` (en) through one `formatMoney(amount, currency, lang)` in `packages/i18n`; legal page by slug in both languages with the `de` fallback; sitemap XML lists only visible providers; translate link shown only when `translatable`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(web): public website pages and sitemaps`.

---

### Task 10: Staff back office with Refine

**Files:**
- Create: `apps/web/app/admin/layout.tsx` (client component with `<Refine>`, `routerProvider` from `@refinedev/nextjs-router`, Ant Design, the `authProvider` and `dataProvider` below), `apps/web/app/admin/sign-in/page.tsx` (email and password via the Neon Auth browser client from `@neondatabase/auth/next`), `apps/web/app/admin/page.tsx` (dashboard: pending documents count, suspended users), resource pages `apps/web/app/admin/documents/{page.tsx,show/[id]/page.tsx}`, `apps/web/app/admin/users/{page.tsx,show/[id]/page.tsx}`, `apps/web/app/admin/providers/{page.tsx,show/[id]/page.tsx}`, `apps/web/app/admin/categories/{page.tsx,edit/[id]/page.tsx,create/page.tsx}`, `apps/web/app/admin/pages/{page.tsx,edit/[id]/page.tsx,create/page.tsx}`, `apps/web/app/admin/staff/page.tsx`
- Create: `apps/web/lib/admin/{auth-provider.ts,data-provider.ts}`, admin API `apps/web/app/api/admin/me/route.ts`, `apps/web/app/api/admin/[resource]/route.ts` (list, create), `apps/web/app/api/admin/[resource]/[id]/route.ts` (get, patch, delete), `apps/web/app/api/admin/documents/[id]/review/route.ts`, `apps/web/app/api/admin/users/[id]/suspend/route.ts`, `packages/domain/src/admin/{documents.ts,users.ts,resources.ts}`
- Test: `apps/web/tests/admin-api.int.spec.ts`, `apps/web/tests/admin-roles.int.spec.ts`

**Interfaces:**
- Produces: resources `documents` (list pending first; review = `POST .../review` with `DocumentReviewInputSchema`; sets `reviewed_by`, `reviewed_at`, sends the Task 11 email), `users` (search by email or name; `POST .../suspend` body `{ until: ISO date | null; reason: string }`; Reviewer may read, only Administrator may suspend), `providers` (read; Reviewer may delete a photo that breaks the rules: `DELETE /api/admin/photos/[id]`), `categories` (Administrator only: names per language, sort, required documents), `pages` (Administrator only: slug, kind, published, title and body per language), `staff` (Administrator only: set `users.staff_role` by email; cannot demote the last Administrator).
- Produces: `requireStaff` from Task 3 used by every admin route; the data provider speaks the `AdminListQuerySchema` query and returns `{ data, total }`; every list has pagination and a text filter.
- Produces: `authProvider.check()` calls `GET /api/admin/me` (session + `staff_role`), `login` uses the browser client's `signIn.email`, `logout` signs out; a signed-in user without a staff role sees "No access" and a sign-out link, never data.

- [ ] **Step 1: Write the failing tests.** `admin-roles`: "Reviewer cannot do Administrator actions" (suspend, categories, pages, staff → 403 and no change), "a customer with no staff role gets 403 on every admin route", "the last Administrator cannot be demoted". `admin-api`: document review approves and the service becomes offerable, rejection stores the note, user suspension sets `suspended_until` and hides the provider from search and the public page, list pagination and filter on users by email, categories create and update per language, pages create and publish.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (Refine shell, providers, pages, admin API, domain). Keep Refine pages thin: `useTable`/`useForm` from `@refinedev/antd` against the data provider; one component per resource page.
- [ ] **Step 4: Run** → PASS; `pnpm --filter web build` succeeds (admin pages are client components, nothing server-only leaks into them).
- [ ] **Step 5: Commit** `feat(admin): staff back office with document review, users, providers, categories, pages, staff roles`.

---

### Task 11: Emails for document decisions

**Files:**
- Create: `packages/domain/src/email.ts` (Resend client; when `RESEND_API_KEY` is empty, log to the console and record in an in-memory outbox for tests), `packages/domain/src/emails/document-decision.ts`
- Modify: `packages/domain/src/admin/documents.ts` (send after review)
- Test: `apps/web/tests/email.int.spec.ts`

**Interfaces:**
- Produces: `sendEmail({ to, lang, template: 'document-approved' | 'document-rejected', params }): Promise<void>`; sender `noreply@skillweb.space`, reply-to `info@skillweb.space`, subject and body from `email.*` keys in the user's language; the app deep link `skillweb://my-profile`.

- [ ] **Step 1: Write the failing tests**: approval sends one email in the user's language with the document name; rejection includes the note; no key → outbox only, no error.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: document decision emails`.

---

### Task 12: Expo app moved over, new auth and API client

**Files:**
- Create: `apps/mobile/` by copying the old repo's `mobile/` (keep `app.json` with `name: 'SkillWeb'`, `slug: 'skilled'`, package `space.skillweb.app`, `extra.eas.projectId b66a6d0d-2214-47e3-85be-cd5501e24f6c`, `owner: liezljvv74`, `eas.json`), then `expo install --check` to current patch versions
- Modify: `apps/mobile/src/api/client.ts` (cookie-based sessions: store the `set-cookie` value in SecureStore under `skilled.session`, send it as `Cookie`; keep the 15-second read limit and the "Cannot reach the server" path), `apps/mobile/src/api/auth.ts` (new: sign-up, sign-in, sign-out, session, send and verify email code, forgot password with code, reset password), `apps/mobile/src/screens/auth/*` (code entry screens replace the link flows), `apps/mobile/src/i18n/index.ts` → re-export from `@kando/i18n` (delete the local dictionaries), `apps/mobile/src/api/*.ts` types → imported from `@kando/contract`
- Test: existing jest suites updated; `apps/mobile/src/api/client.test.ts` gains "sends the stored cookie and stores a new set-cookie"; `apps/mobile/src/api/auth.test.ts` (fetch mocked)

**Interfaces:**
- Consumes: Task 3 REST endpoints and cookie contract; Task 4 catalogue (`t`, `Lang`); Task 7, 8 endpoints unchanged in shape.
- Produces: an app that signs up with email verification by code, logs in, keeps the session for 7 days, shows the home, search, provider (with translate), my-profile (profile, services, references, photos, documents) and account screens as today; the Account tab's Admin link opens `${EXPO_PUBLIC_API_URL}/admin` in the in-app browser (test builds only).

- [ ] **Step 1: Write the failing tests** (client cookie handling; auth module request shapes; i18n keys resolve through the package; profile-form tests unchanged).
- [ ] **Step 2: `cd apps/mobile && npx jest`** → FAIL. **Step 3: Implement.** Metro must resolve workspace packages (`metro.config.js` with `watchFolders` for the monorepo root and `nodeModulesPaths`).
- [ ] **Step 4: `npx jest`, `npx tsc --noEmit`** → PASS; `npx expo export --platform android` succeeds (bundle check without a device); an EAS development build is started with `--no-wait` and its link recorded in the task report.
- [ ] **Step 5: Commit** `feat(mobile): app moved to the monorepo with cookie sessions and shared texts`.

---

### Task 13: Seeds and data scripts

**Files:**
- Create: `packages/db/src/seed/{categories.ts,test-users.ts,placeholder-photos.ts}`, `packages/db/scripts/{seed-categories.ts,seed-test-users.ts,seed-placeholder-photos.ts,import-postcodes.ts}`; root scripts `db:seed:categories`, `db:seed:test-users`, `db:seed:placeholder-photos`, `db:import:postcodes`
- Test: `apps/web/tests/seeds.int.spec.ts`

**Interfaces:**
- Produces: the 14 categories with German and English names and `babysitting.required_documents = ['police-certificate']`; the test users from the old README (same emails, password `TestPass123`) created through the Neon Auth REST sign-up on the dev branch (refuses unless `NEON_BRANCH=dev`), with published providers at the same postcodes and categories; placeholder photos for published profiles without one (on dev at once; elsewhere only with `ALLOW_PRODUCTION=1` and a typed `yes`); the postcode import from `packages/db/data/postcodes-de.tsv`.

- [ ] **Step 1: Write the failing tests**: categories seed is idempotent (run twice → 14); postcode import upserts (run twice → same count); test-user seed refuses on `NEON_BRANCH=main`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(db): seeds and import scripts`.

---

### Task 14: Deployment, parity check, report and README

**Files:**
- Create: `apps/web/vercel.json` (`regions: ["fra1"]`), `docs/deployment.md` (Vercel project with root `apps/web`; env list; Neon project `SkillWeb` with branches `kando-dev` now and `kando-main` at cutover, how `kando-main` is prepared and how the old `main` and `dev` branches are retired after cutover; `neon deploy`; `pnpm db:migrate` against production only on the owner's instruction; trusted domains for Auth), `Reports/Stage-1-Test-Report.xlsx` (Summary, Test Results, Other Checks, Open Items; same columns as the old `Reports/App-Uploads-Test-Report.xlsx`)
- Modify: `README.md` ("Where we are", pick-up list: phone checks of every screen on the dev build against the preview deployment; known gaps carried over from the old README that still apply)

- [ ] **Step 1: Parity walk-through against the old README's feature list** (sign-up with code, login, 7-day session, password reset by code, home, search, provider screen, translate, my profile with services, references, photos, documents, publish and unpublish, admin document review, users, categories, pages, staff roles, website home, provider page, legal pages, sitemaps). Record each as Passed, Not yet done (phone) or Open in the report.
- [ ] **Step 2: Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `cd apps/mobile && npx jest && npx tsc --noEmit`** and record the counts in the report.
- [ ] **Step 3: Commit** `docs: stage 1 report, deployment notes, README`.
