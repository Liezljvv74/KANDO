# Registration and one-page provider setup: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sign-up collects what a customer needs once; the provider setup is one page that saves as you type and publishes with one button; people are told, in the app and by email, when a checked service goes live.

**Architecture:** The person's facts move to `users` (first and last name, private address); the person's picture is the existing `photos` row of kind `profile`, now allowed without a provider; the provider row loses `display_name` and its own photo and can exist empty (draft on first open). Completeness is computed once, on the server, and returned with every profile response; the app only reads it. Emails are chosen after each staff decision from the real state at that moment; a `notifications` table carries the in-app banner and is returned inside `GET /me`. Suspensions end by their date; a daily cron clears ended ones and sends the "published again" email.

**Tech Stack:** Next.js 16 route handlers (`apps/web`), `@kando/domain`, Drizzle + Postgres with RLS (`packages/db`, migration `0008`), Zod contract (`packages/contract`), `@kando/i18n`, Expo app (`apps/mobile`, React Native `Share`, existing pickers), Resend emails, Vercel Cron.

**Spec:** `docs/specs/2026-10-27-registration-and-provider-setup-design.md` (approved 27 October 2026). Foundation: `docs/specs/2026-10-26-kando-foundation-design.md`. Reviewed for efficiency on 27 October (architect review): 14 tasks re-cut to 9, three defects fixed (public picture reads under RLS, two SQL functions using the dropped `suspended` column, services that cannot be saved with a category alone).

## Global Constraints

- Country-ready: address carries `country` (default `'DE'`), no `=== 'en' ? … : …` on language codes; use `isLang`, `DEFAULT_LANG`, `LANGS`, `acceptLang`, `LOCALE` from `@kando/i18n`.
- Every private table has an RLS policy and an isolation test; every route checks the caller (`appRequest` / `adminRequest`); SECURITY DEFINER functions keep `search_path = public, pg_temp`.
- RLS functions and policies live only in `packages/db/src/rls.ts` (applied after every migrate); migrations hold tables, columns, constraints and indexes.
- `users` is a private table: public code (search, public page, sitemap, eligibility functions) never reads it; anything public about a person is on `providers` or `photos`.
- Every user-facing text exists in `packages/i18n/src/de.ts` and `en.ts`, once, added by the task that first uses it; the "same keys in both catalogues" test guards it.
- No new native modules in the app (no new development build). Sharing uses `Share.share` from `react-native`.
- No AI co-author lines in commits. Nobody uses the app: migrations may rebuild columns without preserving data; seeds are updated.
- Every task ends green: `pnpm typecheck && pnpm lint && pnpm test` at the root (Docker Postgres: `docker compose up -d`) and `cd apps/mobile && npx jest && npx tsc --noEmit`. RED before GREEN for every behavioural change.
- Out of scope here: the no-show warning email in the spec's table (comes with the warning feature in Stage 2); Refine's remaining English button labels (known gap).
- Owner merges all PRs; one branch `registration-setup`, one draft PR, test report at the end (`Reports/Registration-Setup-Test-Report.xlsx`, same sheets as `Reports/Stage-1-Test-Report.xlsx`).

## Review Focus

1. An anonymous visitor must see the provider's picture on search cards and the public page (the picture now belongs to the person, and `users` is private): Task 1 tests search and the public page as an anonymous caller.
2. A draft created by opening the page and never touched must not appear anywhere public and must not block the account: Task 3 tests that a draft with nulls is invisible in search and the sitemap and that `GET /me` stays normal.
3. A customer's picture must never be publicly readable unless the person has a live provider profile: Task 1 RLS test.
4. A document approval for a provider who is offline or suspended, or for a requirement that was already approved, must not produce the "profile is live" email or notification: Task 5, one test per row of the spec's email table plus the "already approved" case.
5. Autosave must never revert what the user typed: a failed field save keeps the value on screen with a retry mark: Task 7 jest test on the field-save hook.

---

### Task 1: Data and removals, green suite

**Files:**
- Modify: `packages/db/src/schema/users.ts`, `packages/db/src/schema/providers.ts`, `packages/db/src/schema/files.ts`, `packages/db/src/schema/index.ts`, `packages/db/src/rls.ts`; `packages/contract/src/{me,my-profile,providers,admin,index}.ts`; every reader of `users.name`, `providers.display_name`, `providers.photo_id`, `providers.suspended`, `photos.provider_id` (domain: `users.ts`, `photos.ts`, `providers/{profile,items,public-name,http}.ts`, `public-profile.ts`, `search.ts`, `translate.ts`, `admin/{users,documents,resources}.ts`, `seed/{test-users,placeholder-photos}.ts`; web: `app/(site)/providers/[slug]/page.tsx`, `app/admin/**`, `components/**`; app: `src/screens/search/provider-card.tsx`, `src/screens/provider/provider-screen.tsx`, `src/screens/my-profile/*`, `src/lib/translation.ts`, `src/lib/profile-form.ts`, `src/api/*.ts`); tests: `apps/web/tests/helpers.ts` and every spec that used those fields; `packages/domain/seed-data/test-users.example.json`; `packages/i18n` (remove `profile.displayName*` keys)
- Create: `packages/db/src/schema/notifications.ts`, `packages/db/migrations/0008_*.sql` (+ meta via `pnpm --filter @kando/db exec drizzle-kit generate --name registration_setup`, SQL hand-edited for the check constraints)
- Test: `apps/web/tests/db-migrations.int.spec.ts`, `rls.int.spec.ts`, `rls-providers.int.spec.ts`, `search.int.spec.ts`, `provider-public.int.spec.ts`, `seeds.int.spec.ts`

**Interfaces (produces):**
- `users`: `firstName`, `lastName` (text, nullable; `name` dropped), `addressStreet`, `addressPostcode`, `addressCity`, `addressCountry` (text, nullable; `country` set to `'DE'` whenever the street is set).
- `providers`: `type` nullable; `displayName`, `photoId`, `suspended` dropped; `suspendedUntil` (timestamptz, nullable) added; `services.priceType` and `services.price` nullable (a service may exist with a category alone until Publish; the existing check constraint on `price_type` values keeps NULL allowed).
- `photos`: `providerId` nullable; `kind in ('profile','portfolio')` unchanged; check `(kind = 'profile') = (provider_id IS NULL)`; unique index `photos_one_profile_idx` on `(owner_id)` where `kind = 'profile'`.
- `notifications`: `id` uuid, `userId` text → users, `kind` text check in `('profile-live')`, `payload` jsonb, `createdAt`, `seenAt`, `dismissedAt`; index `(user_id, created_at desc)`.
- RLS (`rls.ts`): `notifications` in `PRIVATE_TABLES` (`user_id = app_current_user_id()`), with `kind`, `payload`, `user_id` in `COLUMN_STAFF_ONLY` for writes (rows are created on the owner connection; the app only sets `seen_at` and `dismissed_at`); `photos.owner` = `owner_id = app_current_user_id() AND (provider_id IS NULL OR <OWN_SERVICE>)`; `photos.publicRead` = `<LIVE_SERVICE> OR (kind = 'profile' AND EXISTS (SELECT 1 FROM providers p WHERE p.owner_id = photos.owner_id AND p.status = 'published' AND (p.suspended_until IS NULL OR p.suspended_until <= now())))`; `providers.publicRead`, `LIVE_SERVICE`, `offerable_service_ids`, `missing_requirements` and `set_provider_published` all use `(suspended_until IS NULL OR suspended_until <= now())` on `providers` (public code never reads `users`); `set_provider_photo` dropped; `COLUMN_STAFF_ONLY.providers` loses `photo_id`, gains `suspended_until`.
- Contract shapes (no new behaviour yet): `MeSchema` = `{ id, email, firstName: string|null, lastName: string|null, language, isProvider, photoUrl: string|null, address: AddressSchema|null, notifications: NotificationSchema[] }`; `AddressSchema = { street: text(120), postcode: text(16), city: text(80), country: z.string().length(2) }`; `MePatchSchema = { firstName: requiredText(60), lastName: requiredText(60), language: LangSchema, address: AddressSchema.nullable() }.partial()`; `MyProfileSchema`: drop `displayName`, `providerType` nullable, `suspendedUntil: string|null` replaces `suspended`, add `missing: MissingSchema[]` with `MissingSchema = z.enum(['photo','service','providerType','businessName','impressum','skills','experience','postcode','radius'])`; `ProfileInputSchema`: drop `displayName`; `ServiceInputSchema`: `title: text(120).optional()`, `priceType: PriceTypeSchema.optional()`, `price` optional; `OwnServiceSchema`: `priceType` and `price` nullable; `NotificationSchema = { id, kind: z.enum(['profile-live']), payload: { url: z.string().url() }, createdAt, seenAt: nullable, dismissedAt: nullable }`; `SearchItemSchema` / `ProviderDetailSchema`: drop `displayName`; `AdminUser`: `firstName`, `lastName`, `address`, `photoUrl`.
- Readers: `publicNameFor(firstName, lastName, businessName, type)` → the business name for a business, else `"First L."`, else `''`; search, public page and sitemap read the picture with `LEFT JOIN photos ph ON ph.owner_id = p.owner_id AND ph.kind = 'profile'`; the public page heading and search card show `publicName`; `translate.ts` translates `bio`, `strengths` and service texts only; `getMyProfile` returns `missing: []` for now (Task 3 fills it) and `GET /me` returns `notifications: []` (Task 5 fills it); the app's provider card and provider screen show `publicName`; the old my-profile screens compile against the new shapes (behaviour replaced in Tasks 7 and 8).
- Seeds: data shape `customers: [{ email, firstName, lastName, language?, address? }]`, `providers: [{ …, profile without displayName, services, references }]`; `buildTestUser` saves names through `updateMe`, gives the picture with `givePlaceholderPhoto(userId, 'First Last')` as a `profile` photo without provider; `addPlaceholderPhotos` covers published providers whose owner has none. The owner's private `seed-data/test-users.json` is converted on this PC (git-ignored; say so in the report).

- [ ] **Step 1: Write the failing tests**
  - `rls.int.spec.ts`: a person's `profile` photo (provider_id NULL) is invisible to another user and to anonymous; it becomes readable once the owner's provider is published; `notifications`: owner reads and marks own rows, another user sees none and cannot insert or change `kind`; a provider with `suspended_until` in the past is visible again.
  - `search.int.spec.ts` and `provider-public.int.spec.ts`: as an anonymous caller, the card and the page carry `photoUrl` from the owner's profile photo and `publicName` `'Lena F.'`; no `displayName` key in the response.
  - `db-migrations.int.spec.ts`: new columns exist, dropped ones do not, and `applyRls()` succeeds on the migrated database (this is what catches a function still using `p.suspended`).
  - `seeds.int.spec.ts` fixture in the new shape.
- [ ] **Step 2: Run** `pnpm test`; expected FAIL on the new assertions.
- [ ] **Step 3: Implement** schema, migration, RLS, contract shapes and every reader until `pnpm typecheck && pnpm lint && pnpm test` and the mobile `jest` + `tsc` are green. No new behaviour beyond what the Interfaces list.
- [ ] **Step 4: Run** everything; expected PASS. Re-run `pnpm db:migrate` and `pnpm db:seed:test-users` against kando-dev and record the counts.
- [ ] **Step 5: Commit** `feat(db): person fields on users, picture as the person's photo, drafts allowed, suspensions by date, notifications`

### Task 2: Me: names, address, picture, admin user page

**Files:**
- Modify: `packages/domain/src/users.ts`, `packages/domain/src/photos.ts`, `packages/domain/src/providers/profile.ts` (`syncIdentity` on rename), `packages/domain/src/admin/users.ts`, `apps/web/app/app-api/v1/me/route.ts`, `apps/web/app/app-api/v1/photos/route.ts`, `apps/web/app/app-api/v1/photos/[id]/route.ts`, `apps/web/app/admin/users/page.tsx`, `apps/web/app/admin/users/show/[id]/page.tsx`, `packages/i18n` (`admin.field.firstName` "First name", `admin.field.lastName` "Surname", `admin.field.address` "Address", `admin.field.picture` "Picture")
- Test: `apps/web/tests/provider-profile.int.spec.ts` (me section), `files.int.spec.ts`, `public-name.int.spec.ts`, `admin-api.int.spec.ts`

**Interfaces:**
- `getMe(tx, userId): Promise<Me>` (`photoUrl` from the owner's `profile` photo); `updateMe(tx, userId, patch: MePatch): Promise<Me>`: address `null` clears the four columns, a non-null address sets `country` (default `'DE'`); a first or last name change calls `syncIdentity` so `providers.public_name` follows; `ensureUser` no longer copies the session name.
- `addPhoto` with kind `profile` works without a provider row: deletes the previous profile photo in the same transaction (file removed after commit), inserts the new one with `provider_id NULL`; `deletePhoto` refuses the profile photo while the owner's provider is published (409 `Profile photo required while published`); `listPhotos` returns the profile photo first.
- `AdminUser` carries `firstName`, `lastName`, `address`, `photoUrl`; the users list shows "First Last"; the user page shows the address block and the picture.

- [ ] **Step 1: Failing tests**: `PATCH /me` with names and address → `GET /me` returns them; renaming the owner of a published provider changes `public_name` to `'Anna S.'` and the public page heading; upload `kind=profile` without a provider row → 201 and `GET /me.photoUrl` set; a second upload leaves one `profile` row and removes the first storage object; `publicNameFor` cases; `GET /photos/[id]` of a customer's picture as another user → 404; `GET /api/admin/users/[id]` returns the new fields.
- [ ] **Step 2: Run** the specs; FAIL. **Step 3: Implement.** **Step 4: Run** all suites; PASS.
- [ ] **Step 5: Commit** `feat(me): names, private address and picture; public name follows a rename; admin user page`

### Task 3: Provider draft, completeness, publish, partial services

**Files:**
- Modify: `packages/domain/src/providers/profile.ts`, `packages/domain/src/providers/items.ts`, `packages/domain/src/providers/http.ts`, `apps/web/app/app-api/v1/provider-profile/route.ts`, `apps/web/app/app-api/v1/services/route.ts`, `apps/web/app/app-api/v1/services/[id]/route.ts`
- Test: `apps/web/tests/provider-profile.int.spec.ts`, `publish-flow.int.spec.ts`, `services-references.int.spec.ts`, `search.int.spec.ts`, `sitemaps.int.spec.ts`

**Interfaces:**
- `ensureDraft(tx, userId): Promise<MyProfile>`: creates the provider row when none exists (`type NULL`, `base_postcode` = `users.address_postcode` when set, radius 25), sets `users.is_provider = true`; `POST /provider-profile` calls it (200 both times).
- `completeness(row, services, hasPhoto): Missing[]` (pure, exported, order as `MissingSchema`): `photo`, `service` (no service with a category and a price type), `providerType`, `businessName` and `impressum` (business only), `skills` (empty), `experience`, `postcode`, `radius`. Every profile response (`GET`, `PUT`, `POST`, publish errors) carries `missing` from this one function; `publish` refuses with 409 `{ error: 'Profile incomplete', missing }`; the old `location` rule is replaced by `postcode`.
- `upsertMyProfile`: partial saves on a draft never fail on business rules; unknown postcode still 400.
- Services: `addService` needs only `categoryId`; `title` empty → the category name in the user's language; `priceType`/`price` may be null until Publish; `updateService` accepts the same partial shape; a service without a price type is never offerable (`offerableServiceIds` and the search SQL add `price_type IS NOT NULL`); `missing` has `service` until one service has both.
- A draft with nulls: not in search, no public page, no sitemap entry; `GET /me` unaffected.
- A draft created during a suspension cannot be published (existing owner check in `set_provider_published`).

- [ ] **Step 1: Failing tests**: POST creates a draft with the postcode prefilled; POST again returns the same id; `missing` on an empty draft is the seven person-independent items (`photo, service, providerType, skills, experience, postcode, radius`), business items appear once type is business, the list shrinks as fields are saved and is present on the `PUT` response; publish of an incomplete draft → 409 with the list; complete → published with `publicName` `'Lena F.'`; a service created with a category alone → 201, title = category name, `priceType: null`, not in search, `missing` still has `service`; setting the price type removes it; draft invisible in search and sitemap; publish during a suspension → 409; `GET /me` for a user with an empty draft is 200 with `isProvider: true`.
- [ ] **Step 2: Run**; FAIL. **Step 3: Implement.** **Step 4: Run** all suites; PASS.
- [ ] **Step 5: Commit** `feat(provider): draft on open, completeness in every response, publish rules, partial services`

### Task 4: Suspensions end by date; suspend and lift emails; daily check

**Files:**
- Modify: `packages/domain/src/admin/users.ts`, `packages/domain/src/email.ts`, `apps/web/app/api/admin/users/[id]/suspend/route.ts`, `apps/web/app/admin/users/show/[id]/page.tsx`, `apps/web/vercel.json` (`crons`), `docs/deployment.md` (`CRON_SECRET`, the cron), `packages/i18n` (`email.suspended.subject` "Your profile was suspended", `email.suspended.body` "Your profile was suspended for the following reason: {reason}. It will be published again on {date}.", `email.publishedAgain.subject` "Your profile is published again", `email.publishedAgain.body` "Your profile has been published again and customers can book your services again. Good and prompt service rewards you with more customers.")
- Create: `apps/web/app/api/cron/suspensions/route.ts`
- Test: `apps/web/tests/admin-api.int.spec.ts`, `email.int.spec.ts`, new `cron-suspensions.int.spec.ts`

**Interfaces:**
- `suspendUser(tx, staff, id, { until, reason })` sets `users.suspended_until/_reason` and `providers.suspended_until` (same value or NULL); the route's `afterCommit` sends `suspended` (reason, date formatted with `LOCALE[lang]`) or, on lift, `published-again`.
- `Template` gains `'suspended' | 'published-again'`; `sendEmail` params become `Record<string, string | null | undefined>`.
- `endExpiredSuspensions(exec): Promise<string[]>`: for users with `suspended_until <= now()`: set both `suspended_until` to NULL and `suspended_reason` to NULL (as a lift does), send `published-again`, return the user ids. Route `GET /api/cron/suspensions`: `authorization: Bearer ${CRON_SECRET}` or 401; `vercel.json` `crons: [{ path: '/api/cron/suspensions', schedule: '0 6 * * *' }]`.
- Admin user page: end date only; `liftPending` and the "expired" state removed.

- [ ] **Step 1: Failing tests**: suspend → outbox has `suspended` with reason and date; lift → `published-again`; cron with a past date → one email and both columns cleared, second call → none; cron without the header → 401; search hides a provider with a future `suspended_until` and shows one whose date passed.
- [ ] **Step 2: Run**; FAIL. **Step 3: Implement.** **Step 4: Run** all suites; PASS.
- [ ] **Step 5: Commit** `feat(admin): suspensions end by their date; suspend and lift emails; daily check`

### Task 5: Document decisions and the profile-live notification

**Files:**
- Modify: `packages/domain/src/notifications.ts`, `packages/domain/src/admin/documents.ts`, `packages/domain/src/email.ts`, `packages/domain/src/users.ts` (`getMe` includes undismissed notifications), `apps/web/app/app-api/v1/me/route.ts`, `packages/i18n` (`email.profileLive.subject` "Your profile is live", `email.profileLive.body` "Your document is approved and your profile is live: {url}\nShare it with people you know.", `email.documentApproved.visible.body` "Your document is approved. Your {category} service is now visible.", `email.documentApproved.offline.body` "Your document is approved. Your profile is offline at the moment; the service becomes visible as soon as you publish again.", `email.documentApproved.suspended.body` "Your document is approved. Your profile is suspended until {date}; the service becomes visible when the suspension ends.", `notification.profileLive` "Your profile is live. Tell people about it.")
- Create: `packages/domain/src/notifications-store.ts`, `apps/web/app/app-api/v1/notifications/[id]/route.ts`
- Test: `apps/web/tests/files-review.int.spec.ts`, `email.int.spec.ts`, new `notifications.int.spec.ts`, `app-endpoints-wrapped.int.spec.ts`

**Interfaces:**
- After the approval commits, `decideApprovalEmail(exec, userId, requirement)` reads on the owner connection: the provider's `status` and `suspended_until`; `affected` = services whose category needs `requirement` and that had no other approved document for it; `stillHidden` = services that still lack an approved document. Rules: rejected → `document-rejected` (unchanged); `affected = 0` → `document-approved` (today's text); no provider or `status !== 'published'` → `document-approved-offline`; suspended → `document-approved-suspended` (date); `stillHidden > 0` → `document-approved-visible` (category name in the user's language); otherwise → `profile-live` email and `createNotification(exec, userId, 'profile-live', { url })`.
- `providerUrl(slug, lang)` in the domain: `${base}/providers/${slug}` plus `?lang=<lang>` when `lang !== DEFAULT_LANG`; base from `NEXT_PUBLIC_SERVER_URL`, else `https://${VERCEL_PROJECT_PRODUCTION_URL}`.
- `createNotification(exec, userId, kind, payload)`, `markNotification(tx, userId, id, { seen?: true; dismissed?: true })`; `GET /me.notifications` = undismissed rows, newest first, max 20; `PATCH /notifications/[id]` body `{ seen?: true; dismissed?: true }`, 404 for another user's row.

- [ ] **Step 1: Failing tests**: one per rule (live and last pending → `profile-live` email and one notification; live with another pending → `visible`; draft → `offline`; suspended → `suspended` with date; approval of a requirement already approved → plain approval, no notification; rejected → unchanged); url carries `?lang=en` for an English provider; `GET /me` lists the notification; `PATCH` dismissed by the owner hides it, by another user → 404.
- [ ] **Step 2: Run**; FAIL. **Step 3: Implement.** **Step 4: Run** all suites; PASS.
- [ ] **Step 5: Commit** `feat(email): decisions say what happened; profile-live notification in /me`

### Task 6: App: sign-up, finishing after the code, nudge, account

**Files:**
- Modify: `apps/mobile/src/screens/auth/sign-up-screen.tsx`, the verify screen under `apps/mobile/src/app/(auth)/`, `apps/mobile/src/hooks/use-session.ts`, `apps/mobile/src/api/client.ts`, `apps/mobile/src/api/my-profile.ts` (profile photo upload without provider), `apps/mobile/src/screens/account-screen.tsx`, the home screen under `apps/mobile/src/screens/home/`, `packages/i18n` (`auth.firstName` "First name", `auth.lastName` "Surname", `auth.offerServices` "I also want to offer services", `auth.pictureWhy` "Providers see who they are working for. A picture keeps both sides safer.", `auth.addressOptional` "Address (optional)", `address.street` "Street and number", `address.postcode` "Postcode", `address.city` "City", `home.pictureNudge` "Add your picture so providers can recognise you. It keeps both sides safer.", `home.pictureAdd` "Add picture", `account.offerServices` "Offer services")
- Create: `apps/mobile/src/components/address-fields.tsx`, `apps/mobile/src/lib/pending-signup.ts`
- Test: `apps/mobile/src/hooks/use-session.test.ts`, new `apps/mobile/src/lib/pending-signup.test.ts`

**Interfaces:**
- Sign-up form in the spec's order; the tick, the picked picture URI and the address are stored in `pending-signup.ts` (SecureStore key `skilled.pendingSignup`) until the code is confirmed; `signUp` sends `name = "First Last"` to Neon Auth for its own record only.
- `verify(email, code)`: after `signedIn(user)`, `completeSignup()`: `PATCH /me { firstName, lastName, language, address? }`, then the picture as `kind=profile` if picked, then clear the record; each step's error is swallowed and the record kept, so `loadSession` retries `completeSignup()` on the next launch while a record exists and the user is signed in.
- Route after confirmation: tick → `/my-profile?welcome=1`, else `/`.
- Home: when `GET /me.photoUrl` is null and `skilled.pictureNudgeDismissed` is not set: banner with `home.pictureNudge`, "Add picture" (picker → profile photo upload) and a dismiss ×.
- Account tab: first name, surname and address editable through `PATCH /me`; picture with pencil; "Offer services" link to `/my-profile`.

- [ ] **Step 1: Failing jest tests**: pending record round trip and clear; `verify` calls `updateMe` with names and address, then the upload, then clears; a failed upload keeps the record; `loadSession` with a record calls `completeSignup` once.
- [ ] **Step 2: Run** `npx jest`; FAIL. **Step 3: Implement.** **Step 4: Run** `npx jest && npx tsc --noEmit`; PASS.
- [ ] **Step 5: Commit** `feat(app): sign-up with names, picture, address and the provider tick; nudge; account fields`

### Task 7: App: the setup page core

**Files:**
- Create: `apps/mobile/src/screens/setup/setup-screen.tsx`, `about-card.tsx`, `publish-bar.tsx`, `apps/mobile/src/hooks/use-field-save.ts`
- Modify: `apps/mobile/src/app/(tabs)/my-profile.tsx` (renders the setup screen), `apps/mobile/src/app/my-profile/*` (edit and service routes removed; reference and photo routes kept), `apps/mobile/src/api/my-profile.ts` (`ensureDraft = POST /provider-profile`), delete `apps/mobile/src/screens/my-profile/{edit-screen,service-screen,my-profile-screen}.tsx` and the parts of `lib/profile-form.ts` no longer used, `packages/i18n` (`setup.title` "My service profile", `setup.welcome` "Let's set up your service profile", `setup.aboutYou` "About you", `setup.publish` "Publish", `setup.publishMissing` "Still missing: {items}", `setup.live` "Live", `setup.liveWaiting` "Live, {count} service(s) waiting for a check", `setup.takeOffline` "Take offline", `missing.photo` "profile picture", `missing.service` "a service with a price type", `missing.providerType` "individual or business", `missing.businessName` "business name", `missing.impressum` "legal notice", `missing.skills` "at least one skill", `missing.experience` "experience", `missing.postcode` "postcode", `missing.radius` "service radius")
- Test: new `apps/mobile/src/hooks/use-field-save.test.ts`, `profile-form.test.ts` adapted or removed

**Interfaces:**
- `useFieldSave<V>(initial: V, save: (value: V) => Promise<unknown>, delayMs = 600)` returns `{ value, setValue, status: 'saved' | 'saving' | 'error', retry, flush }`: one instance per field (About you fields and each service block field); saves after the delay or on blur (`flush`); never resets `value`; on error keeps the value, marks `error`, `retry` resends. (Per-field state, not one object-level hook; the design's "nothing typed is lost" rule.)
- The screen loads `getMyProfile()`, calls `ensureDraft()` once when null, then renders: header (profile photo with pencil → `photosApi` upload kind `profile`, public name, status line), About you card (type, business fields, about you, strengths, skills tags, experience, postcode, radius, remote; each through `useFieldSave` bound to `saveMyProfile`), Past jobs and Portfolio (existing cards), Publish bar.
- Publish bar reads `profile.missing` from the latest server response (every save returns the profile; service and photo changes reload it): disabled with `setup.publishMissing` listing the `missing.*` texts; on press `publishProfile()`; while live: "Live" or "Live, n waiting" (count of services with `waitingFor`), "Take offline" with the existing confirm.
- `?welcome=1` shows `setup.welcome` as the title once.

- [ ] **Step 1: Failing jest tests**: `useFieldSave` coalesces two quick changes into one request, keeps the value and marks `error` on a rejected save, `retry` resends, `flush` saves immediately.
- [ ] **Step 2: Run**; FAIL. **Step 3: Implement.** **Step 4: Run** `npx jest && npx tsc --noEmit`; PASS; `npx expo export --platform android` succeeds.
- [ ] **Step 5: Commit** `feat(app): one-page setup: about you with field saves, publish bar from the server's missing list`

### Task 8: App: services, documents, share, banner

**Files:**
- Create: `apps/mobile/src/screens/setup/services-card.tsx`, `documents-card.tsx`, `apps/mobile/src/lib/share-profile.ts`, `apps/mobile/src/components/notification-banner.tsx`
- Modify: `apps/mobile/src/screens/setup/setup-screen.tsx`, `apps/mobile/src/app/(tabs)/_layout.tsx` (Account badge), `apps/mobile/src/api/my-profile.ts` (`notificationsApi.mark`), `apps/mobile/src/hooks/use-session.ts` or a `useMe` hook (notifications from `/me`), `packages/i18n` (`setup.services` "Services", `setup.addService` "Add another service", `setup.removeService` "Remove", `setup.documents.title` "Verification documents", `setup.documents.body` "The service you provide requires verification documentation. Please add the following documents:", `setup.documents.add` "Add", `setup.liveMessage` "Your profile is live. Tell people about it.", `setup.pendingMessage` "Your profile is live. Your {category} service goes live once we have checked your document.", `setup.share` "Share", `setup.shareText` "Find me on {brand}: {url}")
- Test: new `apps/mobile/src/lib/share-profile.test.ts`, `apps/mobile/src/lib/documents.test.ts` extended (rows across services, deduplicated)

**Interfaces:**
- Services card: one block per service; a block is created on the server when its category is chosen (`servicesApi.create({ categoryId })`), then title, description, price type and price save per field through `useFieldSave` bound to `servicesApi.update`; "Add another service" adds an empty block (no request until a category is chosen); "Remove" deletes.
- Documents card: shown only when `documentRows(services, verifications)` is non-empty, red background `#FDECEC`, text per the spec, one line per requirement across all services with status and an Add button (upload file, gallery, camera as today).
- After Publish: `setup.liveMessage` with Share when no service has `waitingFor`; `setup.pendingMessage` (first waiting category) without Share.
- `shareProfile(url, lang)` → `Share.share({ message: t('setup.shareText', { brand, url }), url })`; url = the website's provider page in the provider's language (same rule as the server's `providerUrl`).
- Banner: the first undismissed `profile-live` notification from `/me` at the top of the setup page with Share and ×; opening the setup page marks it seen; the Account tab badge shows while any notification is unseen.

- [ ] **Step 1: Failing jest tests**: `shareProfile` passes the url and the German text for `de`; `documentRows` deduplicates one requirement shared by two services and keeps the status of the latest document.
- [ ] **Step 2: Run**; FAIL. **Step 3: Implement.** **Step 4: Run** `npx jest && npx tsc --noEmit`; PASS; `npx expo export --platform android` succeeds.
- [ ] **Step 5: Commit** `feat(app): services blocks, documents card, share, profile-live banner`

### Task 9: Report, deployment notes and README

**Files:**
- Modify: `README.md` ("Where we are": the new flow, phone checks to do, seed data shape; Known gaps: Refine labels, push later), `docs/deployment.md` (migration `0008`, `CRON_SECRET` on Vercel, seed data shape)
- Create: `Reports/Registration-Setup-Test-Report.xlsx` (Summary; Test Results from fresh vitest and jest JSON; Other Checks: typecheck, lint, bundle export, rows for sign-up, setup page, publish states, emails, admin page, cron, each "Passed" with the proving spec or "Not yet done (phone)"; Open Items)

- [ ] **Step 1: Run** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `cd apps/mobile && npx jest && npx tsc --noEmit`; record the counts.
- [ ] **Step 2: Write** the report and the docs.
- [ ] **Step 3: Commit** `docs: registration setup report, deployment notes, README`
