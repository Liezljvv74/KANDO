# Registration and one-page provider setup: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sign-up collects what a customer needs once; the provider setup is one page that saves as you type and publishes with one button; people are told, in the app and by email, when a checked service goes live.

**Architecture:** The person's facts move to `users` (first and last name, picture, private address); the provider row loses `display_name` and its own photo and can exist empty (draft on first open). Completeness is computed once on the server and mirrored by the app for the Publish button. Emails are chosen from the real profile state after each staff decision; a `notifications` table carries the in-app banner. Suspensions end by their date; a daily cron sends the "published again" email.

**Tech Stack:** Next.js 16 route handlers (`apps/web`), `@kando/domain`, Drizzle + Postgres with RLS (`packages/db`, migration `0008`), Zod contract (`packages/contract`), `@kando/i18n`, Expo app (`apps/mobile`, React Native `Share`, existing pickers), Resend emails, Vercel Cron.

**Spec:** `docs/specs/2026-10-27-registration-and-provider-setup-design.md` (approved 27 October 2026). Foundation: `docs/specs/2026-10-26-kando-foundation-design.md`.

## Global Constraints

- Country-ready: address carries `country` (default `'DE'`), no `=== 'en' ? … : …` on language codes; use `isLang`, `DEFAULT_LANG`, `LANGS`, `acceptLang`, `LOCALE` from `@kando/i18n`.
- Every private table has an RLS policy and an isolation test; every route checks the caller (`appRequest` / `adminRequest`); SECURITY DEFINER functions keep `search_path = public, pg_temp`.
- RLS functions and policies live only in `packages/db/src/rls.ts` (applied after every migrate); migrations hold tables, columns, constraints and indexes.
- Every user-facing text exists in `packages/i18n/src/de.ts` and `en.ts`, once; the app reads the same catalogue through `apps/mobile/src/i18n`.
- No new native modules in the app (no new development build). Sharing uses `Share.share` from `react-native`.
- No AI co-author lines in commits. Nobody uses the app: migrations may rebuild columns without preserving data; seeds are updated.
- Tests: web integration tests run against the Docker Postgres (`pnpm test` at the root; `docker compose up -d`), mobile with `cd apps/mobile && npx jest && npx tsc --noEmit`; RED before GREEN for every behavioural change.
- Out of scope here: the no-show warning email in the spec's table comes with the warning feature in Stage 2 (bookings); Refine's remaining English button labels are a known gap.
- Owner merges all PRs; one branch `registration-setup`, one draft PR, test report at the end (`Reports/Registration-Setup-Test-Report.xlsx`, same sheets as `Reports/Stage-1-Test-Report.xlsx`).

## Review Focus

1. A provider who already has a published profile when this ships (seeded accounts) must stay published with the derived public name and the owner's picture; the migration plus seeds re-run must leave search and public pages working (Task 1 and 10 tests).
2. A draft created by opening the page and never touched must not appear anywhere public and must not block the account (Task 5 test: draft with nulls is invisible in search and the sitemap).
3. A customer picture must never be publicly readable unless the person has a live provider profile (Task 1 RLS test).
4. A document approval for a provider who went offline or is suspended must not produce the "profile is live" email or notification (Task 7 tests, one per row of the spec's email table).
5. Autosave must never revert what the user typed: a 400 from a field save keeps the value on screen with a retry mark (Task 12 jest test on the autosave hook).

---

### Task 1: Schema, migration 0008 and RLS

**Files:**
- Modify: `packages/db/src/schema/users.ts`, `packages/db/src/schema/providers.ts`, `packages/db/src/schema/files.ts`, `packages/db/src/rls.ts`, `packages/db/src/schema/index.ts`
- Create: `packages/db/src/schema/notifications.ts`, `packages/db/migrations/0008_*.sql` (+ meta via drizzle-kit)
- Test: `apps/web/tests/db-migrations.int.spec.ts`, `apps/web/tests/rls.int.spec.ts`, `apps/web/tests/rls-providers.int.spec.ts`

**Interfaces:**
- Produces: `users.firstName`, `users.lastName` (text, nullable; `name` dropped), `users.photoId` (uuid → `photos.id`, on delete set null), `users.addressStreet`, `users.addressPostcode`, `users.addressCity`, `users.addressCountry` (text, nullable; country default `'DE'` when the street is set), `users.suspendedEndedNotifiedAt` (timestamptz, nullable); `providers.type` nullable, `providers.displayName` and `providers.photoId` dropped, `providers.suspendedUntil` (timestamptz, nullable) replaces `providers.suspended`; `photos.providerId` nullable, `photos_kind_check` allows `'avatar'`, check `(kind = 'avatar') = (provider_id IS NULL)`; table `notifications` (`id` uuid, `userId` text → users, `kind` text check in `('profile-live')`, `payload` jsonb, `createdAt`, `seenAt`, `dismissedAt`), index on `(user_id, created_at desc)`.
- RLS (`rls.ts`): `notifications` in `PRIVATE_TABLES` (`user_id = app_current_user_id()`), insert/update by owner only for `seen_at`/`dismissed_at` (column-level: `kind`, `payload` staff-only for writes, created by the owner connection); `photos.owner` = `owner_id = app_current_user_id() AND (provider_id IS NULL OR <OWN_SERVICE>)`; `photos.publicRead` = `<LIVE_SERVICE> OR (kind = 'avatar' AND EXISTS (SELECT 1 FROM providers p WHERE p.owner_id = photos.owner_id AND p.status = 'published' AND (p.suspended_until IS NULL OR p.suspended_until <= now())))`; `providers.publicRead` and `LIVE_SERVICE` use `(suspended_until IS NULL OR suspended_until <= now())`; `set_provider_photo(uuid)` replaced by `set_user_photo(p_photo_id uuid) RETURNS boolean` (sets `users.photo_id` to one of the caller's own avatar photos or NULL); `set_provider_published` reads the suspension from `users.suspended_until > now()`; `COLUMN_STAFF_ONLY.users` gains `suspended_ended_notified_at`, `COLUMN_STAFF_ONLY.providers` loses `photo_id`, keeps `suspended_until`.

- [ ] **Step 1: Write the failing tests**

In `rls.int.spec.ts` add:
```ts
it('a customer avatar is readable by its owner and staff only; it becomes public with a live provider profile', ...)
// insert user A with avatar photo (provider_id NULL); as user B: SELECT photos → 0 rows; publish A's provider → as B: 1 row
it('notifications: owner reads and marks own rows; another user sees none and cannot insert', ...)
it('an expired suspension (suspended_until in the past) no longer hides the provider', ...)
```
In `db-migrations.int.spec.ts` assert the new columns exist and `providers.display_name` does not.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/web && npx vitest run tests/rls.int.spec.ts tests/db-migrations.int.spec.ts`
Expected: FAIL (columns and policies missing).

- [ ] **Step 3: Implement schema, migration and RLS as in Interfaces**

Generate with `pnpm --filter @kando/db exec drizzle-kit generate --name registration_setup` and hand-edit the SQL for the check constraints and the `photos` nullable change; functions and policies only in `rls.ts`.

- [ ] **Step 4: Run the whole web suite** (`pnpm test`) and fix the compile errors in domain code with the smallest stubs needed (no behaviour yet); expected: the three new tests pass, existing tests that referenced `displayName`/`suspended` are adapted in Tasks 3 to 5 (list them in the report).

- [ ] **Step 5: Commit** `feat(db): users carry name, picture and address; providers lose display name; notifications; suspensions end by date`

### Task 2: Contract and texts

**Files:**
- Modify: `packages/contract/src/me.ts`, `packages/contract/src/my-profile.ts`, `packages/contract/src/providers.ts`, `packages/contract/src/index.ts`, `packages/contract/src/index.test.ts`, `packages/i18n/src/de.ts`, `packages/i18n/src/en.ts`, `packages/i18n/src/index.test.ts`
- Create: `packages/contract/src/notifications.ts`

**Interfaces (produces):**
- `MeSchema`: `{ id, email, firstName: string|null, lastName: string|null, language, isProvider, photoUrl: string|null, address: AddressSchema|null }`; `AddressSchema = { street: text(120), postcode: text(16), city: text(80), country: z.string().length(2) }`; `MePatchSchema = { firstName: requiredText(60), lastName: requiredText(60), language: LangSchema, address: AddressSchema.nullable() }.partial()`.
- `MyProfileSchema`: drop `displayName`; add `missing: z.array(MissingSchema)` with `MissingSchema = z.enum(['photo','service','providerType','businessName','impressum','skills','experience','postcode','radius'])`, `providerType` nullable, `suspendedUntil: z.string().nullable()` replaces `suspended`.
- `ProfileInputSchema`: drop `displayName`; `providerType` stays optional; all partial (unchanged shape otherwise).
- `ServiceInputSchema.title` becomes `text(120).optional()` (server fills from the category); `ServicePatchSchema` unchanged.
- `PhotoKindSchema = z.enum(['avatar','profile','portfolio'])`; `PhotoSchema.kind` uses it (`'profile'` kept for one release as an alias of avatar on read; nothing writes it).
- `NotificationSchema = { id, kind: z.enum(['profile-live']), payload: z.object({ url: z.string().url() }), createdAt, seenAt: nullable, dismissedAt: nullable }`.
- `SearchItemSchema` / `ProviderDetailSchema`: drop `displayName`; `publicName` stays.
- Text keys (both languages), exact English values:
  `auth.firstName` "First name", `auth.lastName` "Surname", `auth.offerServices` "I also want to offer services", `auth.pictureWhy` "Providers see who they are working for. A picture keeps both sides safer.", `auth.addressOptional` "Address (optional)", `address.street` "Street and number", `address.postcode` "Postcode", `address.city` "City", `home.pictureNudge` "Add your picture so providers can recognise you. It keeps both sides safer.", `home.pictureAdd` "Add picture", `setup.title` "My service profile", `setup.welcome` "Let's set up your service profile", `setup.services` "Services", `setup.addService` "Add another service", `setup.removeService` "Remove", `setup.aboutYou` "About you", `setup.documents.title` "Verification documents", `setup.documents.body` "The service you provide requires verification documentation. Please add the following documents:", `setup.documents.add` "Add", `setup.publish` "Publish", `setup.publishMissing` "Still missing: {items}", `setup.live` "Live", `setup.liveWaiting` "Live, {count} service(s) waiting for a check", `setup.takeOffline` "Take offline", `setup.liveMessage` "Your profile is live. Tell people about it.", `setup.pendingMessage` "Your profile is live. Your {category} service goes live once we have checked your document.", `setup.share` "Share", `setup.shareText` "Find me on {brand}: {url}", `missing.photo` "profile picture", `missing.service` "a service", `missing.providerType` "individual or business", `missing.businessName` "business name", `missing.impressum` "legal notice", `missing.skills` "at least one skill", `missing.experience` "experience", `missing.postcode` "postcode", `missing.radius` "service radius", `account.offerServices` "Offer services", `notification.profileLive` "Your profile is live. Tell people about it.", `email.profileLive.subject` "Your profile is live", `email.profileLive.body` "Your document is approved and your profile is live: {url}\nShare it with people you know.", `email.documentApproved.visible.body` "Your document is approved. Your {category} service is now visible.", `email.documentApproved.offline.body` "Your document is approved. Your profile is offline at the moment; the service becomes visible as soon as you publish again.", `email.documentApproved.suspended.body` "Your document is approved. Your profile is suspended until {date}; the service becomes visible when the suspension ends.", `email.suspended.subject` "Your profile was suspended", `email.suspended.body` "Your profile was suspended for the following reason: {reason}. It will be published again on {date}.", `email.publishedAgain.subject` "Your profile is published again", `email.publishedAgain.body` "Your profile has been published again and customers can book your services again. Good and prompt service rewards you with more customers." German texts of the same meaning. Remove `profile.displayName*` keys.

- [ ] **Step 1: Write the failing tests**: `index.test.ts` in contract: `MePatchSchema` accepts `{ address: null }` and rejects `{ address: { postcode: '10115' } }` (street missing); `ServiceInputSchema` accepts a body without title; `MyProfileSchema` requires `missing`. In i18n `index.test.ts`: every listed key exists in both catalogues and the two catalogues have the same key set (there is such a test; it will fail until both are edited).
- [ ] **Step 2: Run** `pnpm --filter @kando/contract test && pnpm --filter @kando/i18n test`; expected FAIL.
- [ ] **Step 3: Implement** the schemas and the texts.
- [ ] **Step 4: Run** again; expected PASS. `pnpm typecheck` will fail in domain/app until Tasks 3 to 5 and 10 to 12; record which packages.
- [ ] **Step 5: Commit** `feat(contract): person fields, address, notifications, missing list; texts for sign-up and setup`

### Task 3: Me: names, address, picture

**Files:**
- Modify: `packages/domain/src/users.ts`, `packages/domain/src/photos.ts`, `apps/web/app/app-api/v1/me/route.ts`, `apps/web/app/app-api/v1/photos/route.ts`, `apps/web/app/app-api/v1/photos/[id]/route.ts`, `packages/domain/src/providers/public-name.ts`
- Test: `apps/web/tests/provider-profile.int.spec.ts` (me section), `apps/web/tests/files.int.spec.ts` (photos), `apps/web/tests/public-name.int.spec.ts`

**Interfaces:**
- Consumes: Task 1 columns, Task 2 schemas.
- Produces: `getMe(tx, userId): Promise<Me>` (photoUrl from `users.photo_id` via the media bucket URL helper already used for provider photos); `updateMe(tx, userId, patch: MePatch): Promise<Me>` (address null clears all four columns; a non-null address sets `country` from the patch, default `'DE'`); `ensureUser` no longer copies the session name (first/last stay null until the app sends them); `publicNameFor(firstName: string|null, lastName: string|null, businessName: string|null, type: 'private'|'business'|null): string` → business name for a business, else `"First L."`, else `''`; `PreparedPhoto.kind` includes `'avatar'`; `addPhoto` with kind `avatar` inserts with `provider_id NULL` and calls `set_user_photo(id)`, replacing the previous avatar (old row deleted after commit, file removed); `deletePhoto` refuses an avatar while the owner's provider is published (409 `Profile photo required while published`, today's rule moved); `listPhotos` returns the avatar first.
- `PATCH /me`, `GET /me` use the new schemas; `POST /photos` accepts `kind=avatar` for any signed-in user (no provider row needed).

- [ ] **Step 1: Failing tests**: `PATCH /me { firstName:'Lena', lastName:'Fischer', address:{…} }` → `GET /me` returns them and `photoUrl: null`; upload `kind=avatar` without a provider row → 201, `GET /me.photoUrl` set; second avatar replaces the first (one photos row, storage object of the first removed); `publicNameFor('Lena','Fischer',null,'private')` → `'Lena F.'`, `(…,'Nordbeat Events GmbH','business')` → the business name; another user cannot read the avatar (RLS test from Task 1 covers the policy; here: `GET /photos/[id]` as another user → 404).
- [ ] **Step 2: Run** the three specs; expected FAIL.
- [ ] **Step 3: Implement** as in Interfaces.
- [ ] **Step 4: Run** again; expected PASS.
- [ ] **Step 5: Commit** `feat(me): first and last name, private address, avatar picture`

### Task 4: Suspensions end by date; admin suspend and lift emails

**Files:**
- Modify: `packages/domain/src/admin/users.ts`, `packages/domain/src/email.ts`, `packages/domain/src/notifications.ts`, `apps/web/app/admin/users/show/[id]/page.tsx`, `apps/web/app/admin/users/page.tsx`
- Create: `apps/web/app/api/cron/suspensions/route.ts`, `apps/web/vercel.json` (add `crons`)
- Test: `apps/web/tests/admin-api.int.spec.ts`, `apps/web/tests/email.int.spec.ts`, new `apps/web/tests/cron-suspensions.int.spec.ts`

**Interfaces:**
- `suspendUser(tx, staff, id, { until, reason })`: sets `users.suspended_until/_reason` and `providers.suspended_until` (same value or NULL), clears `users.suspended_ended_notified_at` on a new suspension; returns the user; the route's `afterCommit` sends `email.suspended` (reason, date formatted with `LOCALE[lang]`) on suspend, `email.publishedAgain` on lift, and sets `suspended_ended_notified_at = now()` on lift.
- `Template` union gains `'suspended' | 'published-again' | 'profile-live' | 'document-approved-visible' | 'document-approved-offline' | 'document-approved-suspended'`; `sendEmail` params become `Record<string, string | null | undefined>` (keys as the texts need).
- `endExpiredSuspensions(exec): Promise<number>`: for users with `suspended_until <= now()` and `suspended_ended_notified_at IS NULL`: send `published-again`, set `suspended_ended_notified_at = now()`; returns the count. Route `GET /api/cron/suspensions` requires header `authorization: Bearer ${CRON_SECRET}` (Vercel sets it), 401 otherwise; `vercel.json` `crons: [{ path: '/api/cron/suspensions', schedule: '0 6 * * *' }]`.
- `getUser` drops `liftPending`; the admin user page shows the end date and, when passed, "ended"; `admin.suspension.expired` text becomes "Ended".

- [ ] **Step 1: Failing tests**: suspend → outbox has `suspended` with reason and date; lift → `published-again`; cron with a past date → one email, second call → zero; cron without the header → 401; search excludes a provider whose `suspended_until` is in the future and includes one whose date passed (extend `search.int.spec.ts`).
- [ ] **Step 2: Run**; expected FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** `pnpm test`; expected PASS.
- [ ] **Step 5: Commit** `feat(admin): suspensions end by their date; suspend and lift emails; daily cron`

### Task 5: Provider draft, completeness, publish, title auto-fill

**Files:**
- Modify: `packages/domain/src/providers/profile.ts`, `packages/domain/src/providers/items.ts`, `packages/domain/src/providers/http.ts`, `apps/web/app/app-api/v1/provider-profile/route.ts`, `apps/web/app/app-api/v1/services/route.ts`, `packages/domain/src/public-profile.ts`, `packages/domain/src/search.ts`, `packages/domain/src/translate.ts`
- Test: `apps/web/tests/provider-profile.int.spec.ts`, `publish-flow.int.spec.ts`, `services-references.int.spec.ts`, `search.int.spec.ts`, `provider-public.int.spec.ts`, `provider-translation.int.spec.ts`, `sitemaps.int.spec.ts`

**Interfaces:**
- `ensureDraft(tx, userId): Promise<MyProfile>`: creates the provider row when none exists (`type NULL`, `base_postcode` = `users.address_postcode` when set, radius 25), sets `users.is_provider = true`, returns the profile; `POST /provider-profile` calls it (200 both times).
- `completeness(row, serviceCount, hasPhoto): Missing[]` (pure, exported; order as `MissingSchema`): `photo` (users.photo_id null), `service` (0 services), `providerType`, `businessName` and `impressum` (business only), `skills` (empty), `experience` (null/blank), `postcode`, `radius`. `getMyProfile` returns `missing` from it; `publish` refuses with 409 `{ error: 'Profile incomplete', missing }` from the same function; publish no longer requires `location` separately (postcode is required for everyone; `worksRemotely` stays a flag).
- `upsertMyProfile`: partial saves on a draft never fail on business rules; a `PUT` with `providerType: 'business'` and no business name is accepted (rules only at publish). Unknown postcode still 400 (`lookupPostcode`).
- `addService`: when `title` is missing or blank, title = the category name in the user's language (`category_texts`); `updateService` with `title: ''` does the same.
- `syncIdentity` derives `public_name` with `publicNameFor` from `users` + provider type/business name; search, public profile and sitemap read the owner's picture via `users.photo_id`; `display_name` gone from every select and response; `translate.ts` translates `bio`, `strengths` and service `title`/`description` only.
- A draft with nulls: not in search, no public page, no sitemap entry (status `draft`).

- [ ] **Step 1: Failing tests** (one `it` each): POST creates a draft with postcode prefilled from the address; POST again returns the same id; `GET /provider-profile.missing` lists the seven person-independent items for an empty draft (`photo, service, providerType, skills, experience, postcode, radius`; the two business items appear only once the type is business) and shrinks as fields are saved; publish of an incomplete draft → 409 with the same list; publish of a complete profile → published, `publicName` `'Lena F.'`, public page shows the avatar; business without impressum → `missing` has `impressum`; service without title gets the category name in `de` for a German user; search card has `publicName` and `photoUrl` from the user; translation response has no `displayName`.
- [ ] **Step 2: Run** the listed specs; expected FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** `pnpm test`; expected PASS (every spec adapted to the new shape; no test may keep a `displayName`).
- [ ] **Step 5: Commit** `feat(provider): draft on open, completeness list, publish rules, category title`

### Task 6: Notifications API

**Files:**
- Create: `packages/domain/src/notifications-store.ts`, `apps/web/app/app-api/v1/notifications/route.ts`, `apps/web/app/app-api/v1/notifications/[id]/route.ts`
- Modify: `packages/domain/src/index.ts`
- Test: new `apps/web/tests/notifications.int.spec.ts`, `apps/web/tests/app-endpoints-wrapped.int.spec.ts` (every route wrapped)

**Interfaces:**
- `createNotification(exec, userId, kind: 'profile-live', payload: { url }): Promise<void>` (owner connection, after commit); `listNotifications(tx, userId): Promise<Notification[]>` (newest first, max 50); `markNotification(tx, userId, id, { seen?: true; dismissed?: true }): Promise<Notification | null>`.
- `GET /notifications` → `{ items }`; `PATCH /notifications/[id]` body `{ seen?: boolean; dismissed?: boolean }` (true only).

- [ ] **Step 1: Failing tests**: create for A; list as A → 1, as B → 0; PATCH seen as B → 404; PATCH dismissed as A → `dismissedAt` set.
- [ ] **Step 2: Run**; FAIL. **Step 3: Implement.** **Step 4: Run**; PASS.
- [ ] **Step 5: Commit** `feat(notifications): store and app endpoints`

### Task 7: Emails and the going-live trigger

**Files:**
- Modify: `packages/domain/src/notifications.ts`, `packages/domain/src/admin/documents.ts`, `packages/domain/src/email.ts`
- Test: `apps/web/tests/files-review.int.spec.ts`, `apps/web/tests/email.int.spec.ts`

**Interfaces:**
- `notifyDocumentDecision(userId, document, state)` where `state = await providerStateAfterApproval(exec, userId)` computed inside the same transaction before commit: `{ status: 'none' | 'draft' | 'published', suspendedUntil: Date | null, hiddenBefore: number, hiddenAfter: number, categoryName: string, url: string }`. Choice: rejected → `document-rejected` (unchanged); approved and `status !== 'published'` → `document-approved-offline`; approved and suspended → `document-approved-suspended` (date); approved, published, `hiddenAfter > 0` → `document-approved-visible` (category); approved, published, `hiddenBefore > 0 && hiddenAfter === 0` → `profile-live` email + `createNotification(userId, 'profile-live', { url })`; approved with nothing hidden before (document for a category the provider does not offer) → `document-approved` (today's text).
- `url` = `${siteBaseUrl()}/providers/${slug}` plus `?lang=en` when the provider's language is not the default (`langPath` from `apps/web/lib/site.ts` is web-only; add `providerUrl(slug, lang)` to the domain with the same rule, base from `NEXT_PUBLIC_SERVER_URL` or `https://${VERCEL_PROJECT_PRODUCTION_URL}`).

- [ ] **Step 1: Failing tests**: one per row: live+last pending → `profile-live` email and one notification; live+another pending → `visible`; draft → `offline`; suspended → `suspended` with date; rejected → unchanged; url has `?lang=en` for an English provider.
- [ ] **Step 2: Run**; FAIL. **Step 3: Implement.** **Step 4: Run**; PASS.
- [ ] **Step 5: Commit** `feat(email): document decisions say what happened; profile-live notification`

### Task 8: Back office: person fields

**Files:**
- Modify: `apps/web/app/admin/users/page.tsx`, `apps/web/app/admin/users/show/[id]/page.tsx`, `apps/web/app/admin/providers/page.tsx`, `apps/web/app/admin/providers/show/[id]/page.tsx`, `packages/domain/src/admin/users.ts`, `packages/domain/src/admin/resources.ts`, `packages/contract/src/admin.ts`, i18n keys `admin.field.firstName`, `admin.field.lastName`, `admin.field.address`, `admin.field.picture`
- Test: `apps/web/tests/admin-api.int.spec.ts`

**Interfaces:** `AdminUser` gains `firstName`, `lastName`, `address` (object or null), `photoUrl`; the users list shows "Name" as `First Last`; the user page shows the address block and the picture; provider pages drop the display name, show the public name.

- [ ] **Step 1: Failing test**: `GET /api/admin/users/[id]` returns `firstName`, `lastName`, `address`, `photoUrl` for a seeded user. **Step 2: Run**; FAIL. **Step 3: Implement.** **Step 4: Run**; PASS; open the pages once with the local dev server and a staff cookie (`pnpm --filter web dev`), note the result in the report.
- [ ] **Step 5: Commit** `feat(admin): person name, address and picture on the user page`

### Task 9: Seeds

**Files:**
- Modify: `packages/domain/src/seed/test-users.ts`, `packages/domain/src/seed/placeholder-photos.ts`, `packages/domain/seed-data/test-users.example.json`, `apps/web/tests/seeds.int.spec.ts`, `README.md` (test accounts paragraph)

**Interfaces:** seed data shape: `customers: [{ email, firstName, lastName, language?, address? }]`, `providers: [{ …, profile: ProfileInput without displayName, services, references }]`; `buildTestUser` sends names through `updateMe`, creates the draft with `ensureDraft`, saves the profile, services, references, gives the avatar with `givePlaceholderPhoto(userId, 'First Last')` (now an avatar on the user), publishes; `addPlaceholderPhotos` gives an avatar to every published provider owner without one. The owner's private `seed-data/test-users.json` is converted by a one-off note in the report (the file is git-ignored: write the converted copy to `seed-data/test-users.json` on this PC and say so).

- [ ] **Step 1: Failing test**: the existing seeds spec fixture updated to the new shape; expect published providers with `publicName` `'Lena F.'`, avatar on the user, `providers.display_name` gone.
- [ ] **Step 2: Run**; FAIL. **Step 3: Implement.** **Step 4: Run**; PASS. Re-run against kando-dev (`pnpm db:seed:test-users` after `pnpm db:migrate`) and record counts.
- [ ] **Step 5: Commit** `chore(seeds): names, avatars and addresses`

### Task 10: App: sign-up, confirmation sequence, account

**Files:**
- Modify: `apps/mobile/src/screens/auth/sign-up-screen.tsx`, `apps/mobile/src/app/(auth)/verify-email.tsx` (or its screen), `apps/mobile/src/hooks/use-session.ts`, `apps/mobile/src/api/client.ts` (`updateMe` typing), `apps/mobile/src/api/my-profile.ts` (avatar upload), `apps/mobile/src/screens/account-screen.tsx`, `apps/mobile/src/screens/home/*` (nudge banner), `apps/mobile/src/i18n/index.ts` (error keys only)
- Create: `apps/mobile/src/components/address-fields.tsx`, `apps/mobile/src/lib/pending-signup.ts`
- Test: `apps/mobile/src/hooks/use-session.test.ts`, new `apps/mobile/src/lib/pending-signup.test.ts`

**Interfaces:**
- Sign-up form fields in the spec's order; the tick and the picked picture URI and the address are kept in `pending-signup.ts` (SecureStore key `skilled.pendingSignup`) until the code is confirmed.
- `verify(email, code)`: after `signedIn(user)`, run `completeSignup()`: `PATCH /me { firstName, lastName, language, address? }`, then upload the picture as `kind=avatar` if one was picked, then clear the pending record; errors are swallowed per step and the record kept, so the next launch retries `completeSignup()` (called from `loadSession` when a pending record exists and the user is signed in).
- Route after confirmation: tick → `/my-profile` (the setup page, Task 11) with `?welcome=1`; else `/`.
- Home: when `GET /me.photoUrl` is null and the nudge was not dismissed this install (`skilled.pictureNudgeDismissed` in SecureStore): banner with `home.pictureNudge`, "Add picture" (picker → avatar upload) and a dismiss ×.
- Account tab: first name, surname, address editable (saves through `PATCH /me`), "Offer services" link to the setup page, picture with pencil.
- `signUp` in `use-session.ts` sends `name = "First Last"` to Neon Auth (its own record only).

- [ ] **Step 1: Failing jest tests**: `pending-signup` round trip and clear; `verify` calls `updateMe` with first/last and the address, then the avatar upload, then clears; a failed avatar upload keeps the pending record; `loadSession` with a pending record calls `completeSignup` once.
- [ ] **Step 2: Run** `npx jest`; FAIL. **Step 3: Implement.** **Step 4: Run** `npx jest && npx tsc --noEmit`; PASS.
- [ ] **Step 5: Commit** `feat(app): sign-up with names, picture, address and the provider tick; picture nudge; account fields`

### Task 11: App: the one-page provider setup

**Files:**
- Create: `apps/mobile/src/screens/setup/setup-screen.tsx`, `services-card.tsx`, `about-card.tsx`, `documents-card.tsx` (red card; reuse `lib/documents.ts` rows), `publish-bar.tsx`, `apps/mobile/src/hooks/use-autosave.ts`, `apps/mobile/src/lib/completeness.ts`, `apps/mobile/src/lib/share-profile.ts`
- Modify: `apps/mobile/src/app/(tabs)/my-profile.tsx` (renders the setup screen), `apps/mobile/src/app/my-profile/*` (edit and service routes removed; reference and photo routes kept), `apps/mobile/src/api/my-profile.ts` (`ensureDraft = POST /provider-profile`), `apps/mobile/src/screens/my-profile/*` (photo-card and portfolio-card reused; the rest deleted), `apps/mobile/src/lib/profile-form.ts`
- Test: new `apps/mobile/src/hooks/use-autosave.test.ts`, `apps/mobile/src/lib/completeness.test.ts`, `apps/mobile/src/lib/share-profile.test.ts`, existing `profile-form.test.ts` adapted

**Interfaces:**
- `useAutosave<T>(save: (patch: Partial<T>) => Promise<unknown>, delayMs = 600)` returns `{ onChange(field, value), status: Record<keyof T, 'saved' | 'saving' | 'error'>, retry(field) }`: coalesces per field, sends one request per field on blur or after the delay, never resets the local value; on error marks the field `error` and keeps the value.
- `computeMissing(profile: MyProfile, services: OwnService[], hasPhoto: boolean): Missing[]` mirrors the server list exactly (used for the button; the server answer wins after Publish).
- `shareProfile(url: string, lang: Lang)` → `Share.share({ message: t('setup.shareText', { brand, url }), url })`.
- Screen: header (avatar with pencil → `photosApi` avatar upload, public name, status line), Services card (blocks bound to `servicesApi` create/update/delete; a new block is created on the server when its category is chosen), About you card (fields bound to `saveMyProfile` through `useAutosave`), Past jobs (existing reference flow), Portfolio (existing), Documents card (only when `documentRows` is non-empty; red background `#FDECEC`, lines with status and Add), Publish bar: disabled with `setup.publishMissing` until `computeMissing` is empty; on press `publishProfile()`; then the message per spec; Share only when no service `waitingFor`; when live: "Live" / "Live, n waiting" plus "Take offline" (`unpublishProfile()` with the existing confirm).
- Opening the tab calls `ensureDraft()` once when `getMyProfile()` is null; `?welcome=1` shows `setup.welcome` as the title once.

- [ ] **Step 1: Failing jest tests**: autosave coalesces two quick changes to one request, keeps the value and marks `error` on a rejected save, `retry` resends; `computeMissing` on an empty draft → the seven items, on a complete profile → `[]`, business without impressum → `['impressum']`; `shareProfile` passes the url and the German text for `de`.
- [ ] **Step 2: Run**; FAIL. **Step 3: Implement** the screen and cards. **Step 4: Run** `npx jest && npx tsc --noEmit`; PASS. Bundle check `npx expo export --platform android` succeeds.
- [ ] **Step 5: Commit** `feat(app): one-page provider setup with autosave, publish and share`

### Task 12: App: notifications banner and dot

**Files:**
- Create: `apps/mobile/src/hooks/use-notifications.ts`, `apps/mobile/src/components/notification-banner.tsx`
- Modify: `apps/mobile/src/screens/setup/setup-screen.tsx`, `apps/mobile/src/app/(tabs)/_layout.tsx` (badge on Account), `apps/mobile/src/api/my-profile.ts` (`notificationsApi`)
- Test: new `apps/mobile/src/hooks/use-notifications.test.ts`

**Interfaces:** `useNotifications()` loads on focus and foreground (via `useLoad`), returns `{ unseen: number, banner: Notification | null, markSeen(id), dismiss(id) }`; the setup screen shows the banner for an undismissed `profile-live` with the Share button; opening the setup page marks it seen; the Account tab shows a badge while `unseen > 0`.

- [ ] **Step 1: Failing test**: with one unseen notification the hook reports `unseen: 1` and `banner`; `dismiss` calls `PATCH … { dismissed: true }` and clears the banner.
- [ ] **Step 2: Run**; FAIL. **Step 3: Implement.** **Step 4: Run**; PASS.
- [ ] **Step 5: Commit** `feat(app): profile-live banner and account badge`

### Task 13: Website and parity sweep

**Files:**
- Modify: `apps/web/app/(site)/providers/[slug]/page.tsx`, `apps/web/components/*` that showed `displayName`, `apps/web/tests/provider-page.int.spec.ts`, `home-page.int.spec.ts`
- Test: the whole suite

- [ ] **Step 1: Failing tests**: provider page shows the public name as heading and the owner's avatar; no `displayName` anywhere in `apps/web` (`grep -rn displayName apps/web packages --include=*.ts --include=*.tsx` returns only the contract alias note, if any).
- [ ] **Step 2: Run**; FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm typecheck && pnpm lint && pnpm test`; PASS.
- [ ] **Step 5: Commit** `feat(site): public name and picture from the person`

### Task 14: Deployment, docs and test report

**Files:**
- Modify: `docs/deployment.md` (env `CRON_SECRET`, the cron, the migration `0008`, seed data shape), `README.md` ("Where we are": the new flow, the phone checks to do; Known gaps: Refine labels still English, push later), `apps/web/vercel.json`
- Create: `Reports/Registration-Setup-Test-Report.xlsx` (Summary, Test Results from fresh vitest/jest JSON, Other Checks: typecheck, lint, bundle export, parity rows for sign-up, setup page, publish states, emails, admin page, cron; Open Items)

- [ ] **Step 1: Run** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `cd apps/mobile && npx jest && npx tsc --noEmit`; record counts.
- [ ] **Step 2: Write** the report and docs; the phone checks are "Not yet done (phone)" rows for the owner.
- [ ] **Step 3: Commit** `docs: registration setup report, deployment notes, README`
