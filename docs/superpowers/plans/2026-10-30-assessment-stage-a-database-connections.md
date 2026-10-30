# Assessment fixes, Stage A: database and connections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Requests can no longer run the database pool dry, and payment, payout, translation and document/photo-upload calls no longer wait on the network inside a transaction (the settlement in the confirm, cancel, stop and dispute endings, handler notifications and chat photo uploads still do; Stage B moves them out), the first-contact user check costs two reads instead of four statements and a write, the database carries the indexes and money constraints the code assumes, the app role can only make the status moves the domain allows, the rate-limit log can no longer be read or poisoned, applying `rls.ts` is atomic and two providers with the same name can publish at once.

**Architecture:** Two `pg` pools in `packages/db/src/client.ts`: the request pool (`appPool`, used only by `asUser`) and the owner pool (`pool`, everything else), each with a size limit, a short idle timeout and an error handler; owner work started inside a request transaction then waits only for the owner pool, never for a connection its own request holds. Network calls leave the request transaction in two ways: an upload is stored in the `prepare` step (before the transaction, removed by `onFailure` when the request fails) and a handler may return an **after-transaction answer** (a function the wrapper calls once the transaction committed) for Stripe and OpenRouter calls. Schema changes go into one migration `0022`; the status-move guard, the translation tables, the slug lock and the atomic apply live in `rls.ts`, which `migrate()` re-applies after every migration.

**Tech Stack:** existing stack (Drizzle 0.45 with node-postgres, Postgres 17 with PostGIS, Vitest 4); nothing new installed.

**Spec:** `docs/superpowers/specs/2026-10-30-assessment-findings.md` (items 5, 6, 8, 15, 16, 17, 18, 19). Read `apps/web/AGENTS.md` first. Later stages: B (`2026-10-30-assessment-stage-b-*.md`), C, D consume the names in the Interfaces blocks below.

## Findings covered (verified in the code on `release/assessment-fixes`, 7617df9)

- **5** pool and connections: **confirmed.** `packages/db/src/client.ts:33` creates `new pg.Pool({ connectionString, connectionTimeoutMillis: 10_000 })`: no `max`, no `idleTimeoutMillis`, no `pool.on('error')` (an idle client dropped by Neon emits `error` with no listener and kills the process). One pool serves both `asUser` (`as-user.ts:6`) and the owner connection `db`, and handlers use `db` while their request transaction is open: `bookings/bookings.ts:67` and `bookings/requests.ts:153` (`runDueTimersFor(db, …)`), `payments/checkout.ts:43-48,84`, `chat/flags.ts:22`, every ending's `db.transaction` (`cancel.ts`, `finish.ts`, `stop.ts`, `disputes.ts`, `additional.ts`). With ten requests in flight each holding its transaction and waiting for an owner connection, every one of them waits until the 10 s timeout. Network calls inside the request transaction: `translate.ts:168` (OpenRouter), `photos.ts:91` and `documents.ts:59` (S3 put, under the profile lock), `payments/checkout.ts:66` and `payments/onboarding.ts:24,34,44` (Stripe). `payments/settle.ts:75-79` calls Stripe under the booking row lock **on purpose** (crash-safety table, `settle.ts:17-33`, idempotency keys; Stripe client timeout 15 s, `stripe-gateway.ts:53`): kept, see "Deliberately not changed". `attachDatabasePool` needs `@vercel/functions`, not installed: owner decision, see below.
- **6** `ensureUser`: **confirmed.** `users.ts:51-63`: `to_regclass` on every request, the Neon Auth lookup, an `INSERT … ON CONFLICT DO UPDATE SET email` that rewrites the row every time, then a separate `SELECT`; four round trips and a row version per request (chat polling every 4 s included).
- **8** missing indexes: **confirmed** (none of the 29 indexes in Task 6 exist; `providers.location` has no index although `search.ts:65,79` filters and sorts by `p.location::geography`).
- **15** row policies too wide: **confirmed, partly mitigated.** `rls.ts:17-19` gives both parties full UPDATE on `requests`, `quotes`, `bookings`; `schema/bookings.ts:5` says status is "enforced in the domain". `bookings_guard_status` (`rls.ts:393-404`) already blocks the paid and ending statuses; everything else is open: a provider can set a request to `booked`, a customer can set `pay_by` a month ahead, either side can move `answer_by`, `counter_by`, `accepted_at`, `start_at` of an awaiting-payment booking. The app role writes statuses only at `bookings.ts:97,135` and `requests.ts:200,216,253,254`; expiry runs on the owner connection (`runDueTimersFor(db, …)`), the endings on `db` too.
- **16** `translation_requests`: **confirmed.** `rls.ts:126,236-243`: `public_read USING (true)` and `app_insert WITH CHECK (true)` on both translation tables; anyone can read every client key and insert rows under someone else's key (exhausting their hourly limit).
- **17** money constraints: **confirmed.** `schema/bookings.ts:108-112`: `payment_ref` not unique, `amount`, `commission_rate`, `stop_amount`, `material_amount`, `duration_min` without range checks; `currency` is free text on `bookings`, `quotes`, `services`, `ledger_entries`, `invoices`, `commission_invoices`.
- **18** migration atomicity: **confirmed.** `rls.ts:513-516` runs about 150 statements one by one on autocommit (between `REVOKE … ON ALL TABLES` and the per-table `GRANT`s the app role briefly has no write grants; a failure halfway leaves that state). Drizzle's node-postgres migrator runs all pending migrations in **one** transaction (`node_modules/drizzle-orm/pg-core/dialect.js`, `migrate()`: `session.transaction(...)` around every pending file), so every `ADD CONSTRAINT … CHECK` (the `notifications_kind_check` rewrites in 0013 and 0018 to 0021) holds an ACCESS EXCLUSIVE lock on `notifications` while it scans the table, until the whole run commits.
- **19** slug collision: **confirmed.** `rls.ts:266-269`: `WHILE EXISTS (SELECT 1 FROM providers WHERE slug = s)` without a lock; two transactions publishing the same base both pick it and the second fails on the unique index (`providers.slug`, 23505, answered 500).

## Global Constraints

- Branch `assessment-a-database` from `release/assessment-fixes`; pull request into `release/assessment-fixes`; the owner merges (squash). Stages merge in order A, B, C, D.
- Migration number **0022** is this stage's only migration (B uses 0023, C 0024, D 0025, only if needed). Generate with `pnpm db:generate`, then hand-edit the SQL where a task says so; never edit an applied migration.
- **No `CREATE INDEX CONCURRENTLY` and no `NOT VALID … VALIDATE` pair in 0022:** the migrator wraps every pending migration in one transaction, where `CONCURRENTLY` is an error and a `VALIDATE` in the same transaction still scans under the lock taken by `ADD CONSTRAINT`; production `kando-main` has no bookings and one account, so plain `CREATE INDEX` and plain `ADD CONSTRAINT` lock empty tables for milliseconds. (`kando-dev` has test data: Task 6 checks it first.)
- **Rule for later migrations (written into `migrate.ts` in Task 8):** widening an existing status or kind `CHECK` is hand-edited to `DROP CONSTRAINT …; ADD CONSTRAINT … CHECK (…) NOT VALID` with no `VALIDATE` (the old rows satisfy the narrower list, so nothing needs checking and no scan runs). A new constraint on a table that holds real data, and any `CREATE INDEX CONCURRENTLY`, needs a step outside the migrator's transaction: not built (YAGNI until production holds data).
- `rls.ts` is re-applied by every `pnpm db:migrate`; every rule a later stage must extend lives there under a named constant.
- Pool sizes: `APP_POOL_MAX = 10`, `OWNER_POOL_MAX = 10`, `POOL_IDLE_MS = 5_000`, `connectionTimeoutMillis` stays `10_000`.
- TDD: each task's test first, seen failing, then the code. Web integration tests need Docker (`docker compose up -d --wait db`); run them with `pnpm --filter web exec vitest run <files>`; domain, contract, i18n with `pnpm --filter <pkg> test`; mobile is jest (`pnpm --filter mobile test`).
- No new dependency. No new user-facing text in this stage (if one appears, German and English in `packages/i18n` with parity). No Germany-only assumption (currency checks are ISO-4217 format, not `'EUR'`).
- Commit messages: Conventional Commits; no AI co-author line and no "Generated with" line.

## Review Focus

- More concurrent requests than `APP_POOL_MAX`, each doing owner-connection work inside its transaction (the booking list's due-timer run): all finish, none waits 10 s for a connection (Task 1 test `request transactions beyond the pool size that use the owner connection all finish`).
- A portfolio upload that is refused after the object was stored (the 13th photo, the 11th pending document, a suspended person, a failed commit): the answer is 409 or 403 and the object is gone from storage (Task 5 tests `a refused upload leaves no object`).
- OpenRouter times out or answers 500 after the rate-limit row was written: the answer is 503, the counter row stays (the limit still holds), and no request transaction was open during the call (Task 4 test `the model call runs with no request transaction open; a failed call still counts`).
- A party crafts an update the domain never makes (the provider sets the request to `booked`, the customer moves `pay_by` past the start or sets it while the booking is still proposed, either side changes the start time of an awaiting-payment booking) while every real flow still passes (Task 7 tests `app_user cannot make a status move the domain does not make` and `pay_by and the proposal columns move only with their transition`).
- Two providers with the same public name tap Publish at the same moment: both succeed with `anna-m` and `anna-m-2`, no 500 (Task 8 test `two providers with the same name publish at once`).

## File structure

- `packages/db/src/client.ts`: two pools, limits, error handler. `packages/db/src/as-user.ts`: uses the request pool.
- `packages/domain/src/app-request.ts`: `prepare` receives `onFailure`; a handler may return an after-transaction answer.
- `packages/domain/src/users.ts`: `ensureUser` with a cached Neon Auth check and a write only when the email changed.
- `packages/domain/src/translate.ts`, `apps/web/app/app-api/v1/providers/[slug]/translation/route.ts`: the model call after the commit, the counter on the owner connection.
- `packages/domain/src/photos.ts`, `packages/domain/src/documents.ts`: the object is stored in `prepare`.
- `apps/web/app/app-api/v1/bookings/[id]/pay/route.ts`, `apps/web/app/app-api/v1/payouts/{setup,status}/route.ts`, `packages/domain/src/payments/onboarding.ts`: Stripe after the commit.
- `packages/db/src/schema/*.ts` and `packages/db/migrations/0022_*.sql`: indexes and money constraints.
- `packages/db/src/rls.ts`: translation tables reclassified, status-move guard, slug lock, atomic `applyRls`. `packages/db/src/migrate.ts`: the CHECK-widening rule.
- Tests: `apps/web/tests/db-pool.int.spec.ts` (new), and the existing `app-request.int.spec.ts`, `translate.int.spec.ts`, `provider-translation.int.spec.ts`, `files.int.spec.ts`, `payments.int.spec.ts`, `payouts.int.spec.ts`, `db-migrations.int.spec.ts`, `rls.int.spec.ts`, `rls-bookings.int.spec.ts`, `rls-payments.int.spec.ts`, `publish-flow.int.spec.ts`.

---

### Task 1: Two bounded pools with an error handler (item 5)

**Files:**
- Modify: `packages/db/src/client.ts:20-33`, `packages/db/src/as-user.ts:6-11`
- Test: `apps/web/tests/db-pool.int.spec.ts` (new)

**Interfaces:**
- Produces (exported from `@kando/db`): `pool: pg.Pool` and `db` (the owner connection, unchanged names), `appPool: pg.Pool`, `appDb` (Drizzle over `appPool`, used by `asUser` only), constants `APP_POOL_MAX = 10`, `OWNER_POOL_MAX = 10`, `POOL_IDLE_MS = 5_000`. Both pools are created lazily by one `makePool(max: number): pg.Pool` that sets `max`, `idleTimeoutMillis: POOL_IDLE_MS`, `connectionTimeoutMillis: 10_000` and attaches `on('error', (e) => console.error('[db] idle client error', e.message))`.
- `asUser(userId, fn)` keeps its signature; it now opens its transaction on `appDb`.

- [ ] **Step 1: Write the failing tests** in `db-pool.int.spec.ts`:
  - `an idle-client error is logged, not thrown`: `expect(() => pool.emit('error', new Error('gone'))).not.toThrow()`; the same for `appPool`.
  - `the pools are bounded`: `expect(pool.options.max).toBe(OWNER_POOL_MAX)`, `expect(appPool.options.max).toBe(APP_POOL_MAX)`, `expect(appPool.options.idleTimeoutMillis).toBe(POOL_IDLE_MS)`.
  - `request transactions beyond the pool size that use the owner connection all finish`: start `APP_POOL_MAX + 5` calls of `asUser(null, async () => { await new Promise((r) => setTimeout(r, 50)); await db.execute(sql\`SELECT 1\`) })` at once; `await Promise.all(...)` resolves within 5 s (vitest `timeout: 5_000`).
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run tests/db-pool.int.spec.ts`: FAIL (`appPool` is not exported).
- [ ] **Step 3: Implement** `makePool`, `appPool`, `appDb` in `client.ts` (keep the lazy `Proxy` with `getPrototypeOf` for both: drizzle needs `instanceof Pool` to give a transaction its own connection) and switch `as-user.ts` to `appDb.transaction`. Comment on `appPool`: request transactions only, so owner work inside one never waits for a connection a request holds. Add a `ponytail:` comment on `OWNER_POOL_MAX`: `settle` holds two owner connections at once (`settle.ts:33`), so more than `OWNER_POOL_MAX / 2` settlements in parallel on one instance can still wait; the cron settles one at a time.
- [ ] **Step 4: Run** the new spec, then `tests/concurrency.int.spec.ts tests/owner-connection.int.spec.ts tests/app-request.int.spec.ts tests/test-guard.int.spec.ts`: PASS. If the test global setup's `pool.end()` leaves `appPool` open, end `appPool` there as well (`packages/db/src/test/setup.ts`).
- [ ] **Step 5: Commit** `fix(db): separate bounded pools for request transactions and the owner connection`.

### Task 2: `ensureUser` in two reads (item 6)

**Files:**
- Modify: `packages/domain/src/users.ts:49-71`
- Test: `apps/web/tests/app-request.int.spec.ts`

**Interfaces:**
- `ensureUser(session, request): Promise<SessionUser>` keeps its signature and its errors (`SessionGoneError`, `EmailConflictError`).
- Module-level `let neonAuthPresent: boolean | undefined`, filled by the first `to_regclass('neon_auth."user"')` and reused (the schema does not appear or vanish while the process runs).
- Order: (1) the Neon Auth lookup when present; (2) `SELECT` the users row; found with the same email: return it (no write); found with another email: `UPDATE users SET email = … WHERE id = … RETURNING *`; not found: `INSERT … ON CONFLICT (id) DO UPDATE SET email = excluded.email RETURNING *` (a concurrent first contact). A 23505 on either write is `EmailConflictError` as today.

- [ ] **Step 1: Write the failing tests**:
  - `a known user with an unchanged email is not rewritten`: call `ensureUser` twice for the same session; `SELECT xmin FROM users WHERE id = $1` is equal before and after the second call.
  - `an email changed in Neon Auth is synced`: second call with a new email returns it and the row has it.
  - Existing tests for `SessionGoneError` (deleted Neon Auth account: 401) and `EmailConflictError` (409) stay green.
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run tests/app-request.int.spec.ts`: the xmin test FAILS.
- [ ] **Step 3: Implement** as in Interfaces.
- [ ] **Step 4: Run** `tests/app-request.int.spec.ts tests/auth-cookie-flow.int.spec.ts tests/account-delete.int.spec.ts`: PASS.
- [ ] **Step 5: Commit** `perf(domain): ensureUser reads twice and writes only when the email changed`.

### Task 3: After-transaction answers; Stripe calls leave the request transaction (item 5)

**Files:**
- Modify: `packages/domain/src/app-request.ts` (type `Handler`, the call of `asUser`, the `prepare` call), `apps/web/app/app-api/v1/bookings/[id]/pay/route.ts`, `apps/web/app/app-api/v1/payouts/setup/route.ts`, `apps/web/app/app-api/v1/payouts/status/route.ts`, `packages/domain/src/payments/onboarding.ts:19-46`
- Test: `apps/web/tests/app-request.int.spec.ts`, `apps/web/tests/payments.int.spec.ts`, `apps/web/tests/payouts.int.spec.ts`

**Interfaces:**
- `export type AfterTransaction = () => Promise<Response>`; `Handler<P>` now returns `Promise<Response | AfterTransaction>`. The wrapper commits the transaction (`asUser` returns), clears `failQueue`, then, when the handler returned a function, awaits it **outside any transaction** and uses its `Response`; then runs the after-commit queue as today. A `Response` thrown by the function (`fail(...)`) is the answer; anything else is the logged 500. Nothing else in the wrapper changes (Stage B will move the after-commit queue to Next's `after()`, Stage C will change the `maxBodyBytes` check).
- `Opts.prepare` becomes `(request: Request, onFailure: AfterCommit) => Promise<P>` (used by Task 5; existing `prepare` functions ignore the second argument).
- `startPayoutSetup(exec: Exec, userId: string)` and `payoutStatus(exec: Exec, userId: string)`: first parameter widened from `Tx` to `Exec` (`providers/eligibility.ts:8`); `ownProvider` gets `Pick<Tx, 'select'>` like `isSuspendedNow`. `createPayLink(exec, userId, bookingId, now)` is unchanged (already `Exec`).
- Routes: pay returns `() => createPayLink(db, user!.id, params.id!).then((r) => Response.json(r))` when payments are on (503 `PAYMENTS_OFF` stays a plain answer); payouts setup and status likewise with `startPayoutSetup(db, …)`, `payoutStatus(db, …)`. Stage D's Pay now work consumes these routes unchanged in shape (same request, same `PayLinkSchema` answer).

- [ ] **Step 1: Write the failing tests**:
  - `app-request.int.spec.ts` `an after-transaction answer runs once the transaction committed`: a test route whose handler inserts a row on `tx` and returns `async () => { const seen = await db.execute(sql\`SELECT … that row\`); return Response.json({ seen: seen.rows.length, busy: appPool.totalCount - appPool.idleCount }) }`; expect `{ seen: 1, busy: 0 }`.
  - `a Response thrown by an after-transaction answer is the answer`: the function throws `Response.json({ error: 'x' }, { status: 409 })`; status 409.
  - `payments.int.spec.ts` `the checkout session is created with no request transaction open`: the fake gateway's `createCheckout` (`tests/fake-gateway.ts`) records `appPool.totalCount - appPool.idleCount`; after POST pay it is `0`, and the answer is the pay link as before.
  - `payouts.int.spec.ts` the same for `onboardingLink` and `accountReady`.
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run tests/app-request.int.spec.ts tests/payments.int.spec.ts tests/payouts.int.spec.ts`: FAIL.
- [ ] **Step 3: Implement** the wrapper change, the widened parameters and the three routes.
- [ ] **Step 4: Run** the three specs plus `tests/app-endpoints-wrapped.int.spec.ts tests/fake-gateway.int.spec.ts`: PASS. `cd packages/domain && npx tsc --noEmit` and `cd apps/web && npx tsc --noEmit`: clean.
- [ ] **Step 5: Commit** `fix(domain): Stripe calls run after the request transaction`.

### Task 4: Translation outside the request transaction; rate-limit log owner-only (items 5, 16)

**Files:**
- Modify: `packages/domain/src/translate.ts:110-193`, `apps/web/app/app-api/v1/providers/[slug]/translation/route.ts`, `packages/db/src/rls.ts` (`INSERT_ONLY_TABLES`, its branch in `policyStatements`, the default list in `rlsStatements`, `classifyTables`, `TRANSLATION_FUNCTIONS`, `PUBLIC_REFERENCE_TABLES`, `STAFF_ONLY_TABLES`)
- Test: `apps/web/tests/translate.int.spec.ts`, `apps/web/tests/provider-translation.int.spec.ts`, `apps/web/tests/rls.int.spec.ts`

**Interfaces:**
- `translateTexts(exec: Exec, texts, lang, clientKey, storedOnly = false)`: first parameter widened from `Tx` to `Exec`. The site page (`app/(site)/providers/[slug]/page.tsx:86`) keeps passing its `tx` with `storedOnly = true` (reads only). The route passes `db` from an after-transaction answer (Task 3): the handler reads the profile in `tx`, then returns `async () => { try { return Response.json(await translateTexts(db, textsOf(profile), lang, clientKey)) } catch (e) { if (e instanceof TranslationUnavailable) return 503; throw e } }`.
- `askModel(exec, …)`: the prune is `DELETE FROM translation_requests WHERE created_at < now() - interval '24 hours'` on `exec`; the count and the insert run on `exec` (autocommit on `db`: other requests see the counter at once). Remove the `ponytail:` comment it resolves.
- `rls.ts`: `translations` moves to `PUBLIC_REFERENCE_TABLES` (app reads, owner writes), `translation_requests` to `STAFF_ONLY_TABLES`; `INSERT_ONLY_TABLES` and its branch are deleted (no table left); `TRANSLATION_FUNCTIONS` becomes `['DROP FUNCTION IF EXISTS prune_translation_requests()']`. Keep `'app_insert'` in `POLICY_NAMES`. The leftover policies on the two tables are dropped in 0022 (Task 6).

- [ ] **Step 1: Write the failing tests**:
  - `rls.int.spec.ts` `app_user can neither read nor write translation_requests and cannot insert translations`: as `asUser('x', …)`: `SELECT` from `translation_requests` and `INSERT INTO translation_requests` and `INSERT INTO translations` each reject with "permission denied"; `SELECT` from `translations` works.
  - `translate.int.spec.ts` `the model call runs with no request transaction open; a failed call still counts`: stub `fetch` to record `appPool.totalCount - appPool.idleCount` and answer 500; call the route; expect 503, recorded `0`, and one `translation_requests` row for the client key.
  - `provider-translation.int.spec.ts`: the existing happy path and limit tests stay green through the route.
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run tests/rls.int.spec.ts tests/translate.int.spec.ts tests/provider-translation.int.spec.ts`: FAIL.
- [ ] **Step 3: Implement** as in Interfaces.
- [ ] **Step 4: Run** the three specs plus `tests/provider-page.int.spec.ts tests/no-raw-sql.int.spec.ts tests/db-migrations.int.spec.ts`: PASS.
- [ ] **Step 5: Commit** `fix(domain): translate after the request transaction; rate-limit log owner-only`.

### Task 5: Uploads are stored before the transaction (item 5)

**Files:**
- Modify: `packages/domain/src/photos.ts:22-36,77-111`, `packages/domain/src/documents.ts:31-68`, `apps/web/app/app-api/v1/photos/route.ts`, `apps/web/app/app-api/v1/files/route.ts`
- Test: `apps/web/tests/files.int.spec.ts`, `apps/web/tests/provider-profile.int.spec.ts` (or wherever the photo upload tests live: `grep -l "app-api/v1/photos" apps/web/tests`)

**Interfaces:**
- Consumes: `Opts.prepare(request, onFailure)` from Task 3.
- `preparePhoto(request, onFailure): Promise<PreparedPhoto>` and `prepareDocument(request, onFailure): Promise<PreparedDocument>`: after the existing checks they `storage().put(...)` the object and register `onFailure(() => removeObject(bucket, key))`; both types gain `key: string`. Keys no longer need the provider id: profile `people/<uuid>/<uuid>.jpg` (as today), portfolio `portfolio/<uuid>/<uuid>.jpg`, document `documents/<userId>/<uuid>.<ext>` (as today). Nothing reads key prefixes (checked: only `chat/<threadId>/` in `chat/messages.ts:22`, unchanged).
- `addPhoto` and `uploadFile` lose their `storage().put` and their own `removeObject` on failure; they insert the row with `prepared.key`.
- Chat photos (`chat/messages.ts:71-79`) are **not** moved: their key is bound to the thread and the membership check must come before the put.

- [ ] **Step 1: Write the failing tests**:
  - `a refused upload leaves no object`: a 13th portfolio photo answers 409 and the storage stub holds no new object; an 11th pending document answers 409 likewise; a suspended person's upload answers 403 likewise (the suspension check runs after `prepare`, `app-request.ts`).
  - `the object is stored before the transaction opens`: the storage stub's `put` records `appPool.totalCount - appPool.idleCount`; expect `0`.
- [ ] **Step 2: Run** the spec(s): FAIL.
- [ ] **Step 3: Implement** as in Interfaces.
- [ ] **Step 4: Run** `tests/files.int.spec.ts tests/files-review.int.spec.ts tests/document-replace.int.spec.ts tests/provider-profile.int.spec.ts tests/publish-flow.int.spec.ts`: PASS.
- [ ] **Step 5: Commit** `fix(domain): store uploads before the request transaction`.

### Task 6: Migration 0022: indexes and money constraints (items 8, 17)

**Files:**
- Modify: `packages/db/src/schema/{chat,bookings,providers,files,endings,payments,invoices,notifications,users}.ts`
- Create: `packages/db/migrations/0022_<generated name>.sql` (+ snapshot, journal)
- Test: `apps/web/tests/db-migrations.int.spec.ts`, `apps/web/tests/rls-payments.int.spec.ts`

**Interfaces (Stage B consumes these names; it adds no index of its own for search or the cron):**
- Foreign-key and lookup indexes: `threads_customer_id_idx (customer_id)`, `threads_provider_id_idx (provider_id)`, `messages_sender_id_idx (sender_id)`, `blocks_blocked_id_idx (blocked_id)`, `staff_flags_user_id_idx (user_id)`, `staff_flags_kind_ref_id_idx (kind, ref_id)` (the timers' `NOT EXISTS` lookups have no `resolved_at` filter, so `staff_flags_open_idx` does not serve them), `contact_attempts_user_id_created_at_idx (user_id, created_at)` (`chat/flags.ts:22`), `contact_attempts_thread_id_idx (thread_id)`, `bookings_service_id_idx (service_id)`, `bookings_quote_id_idx (quote_id)`, `requests_service_id_idx (service_id)`, `requests_parent_booking_id_idx (parent_booking_id)`, `services_category_id_idx (category_id)`, `photos_owner_id_idx (owner_id)`, `private_files_owner_id_idx (owner_id)`, `reviews_author_id_idx (author_id)`, `ledger_entries_provider_id_created_at_idx (provider_id, created_at)` (`invoices/commission.ts:60,89`).
- Search: `providers_location_gist` `USING gist ((location::geography))`, the same expression as `postcodes_location_gist` and as `search.ts:65,79` (not partial: `ST_DWithin` does not let the planner prove `location IS NOT NULL`).
- Cron, partial: `requests_open_answer_by_idx (answer_by) WHERE status = 'open'`, `quotes_sent_expires_at_idx (expires_at) WHERE status = 'sent'`, `bookings_proposed_answer_by_idx (answer_by) WHERE status = 'proposed'`, `bookings_awaiting_pay_by_idx (pay_by) WHERE status = 'awaiting-payment'`, `bookings_finished_confirm_by_idx (confirm_by) WHERE status = 'finished'`, `disputes_open_decide_by_idx (decide_by) WHERE decided_at IS NULL`, `reviews_reveal_pending_idx (visible_at) WHERE reveal_told_at IS NULL`, `notifications_requests_ignored_idx (user_id, created_at) WHERE kind = 'requests-ignored'`, `users_suspended_until_idx (suspended_until) WHERE suspended_until IS NOT NULL`, `providers_suspended_until_idx (suspended_until) WHERE suspended_until IS NOT NULL`, `retained_records_delete_after_idx (delete_after)`.
- Constraints (plain `ADD CONSTRAINT`, see Global Constraints): `bookings_payment_ref_idx` UNIQUE `(payment_ref)`; `bookings_amount_check amount >= 0`; `bookings_commission_rate_check commission_rate >= 0 AND commission_rate < 1`; `bookings_stop_amount_check stop_amount >= 0 AND stop_amount <= amount`; `bookings_material_amount_check material_amount >= 0 AND material_amount <= amount`; `bookings_duration_check duration_min > 0`; `quotes_amount_check amount >= 0`; `quotes_duration_check duration_min > 0`; `quotes_version_check version >= 1`; `services_price_check price >= 0`; `invoices_total_check total >= 0`; `commission_invoices_total_check total >= 0`; and `<table>_currency_check currency ~ '^[A-Z]{3}$'` on `bookings`, `quotes`, `services`, `ledger_entries`, `invoices`, `commission_invoices` (ISO format, not a fixed list: a second market needs no migration; a foreign key to `currencies` was considered and left out because the ledger keeps rows of currencies no longer offered).
- Hand-added at the end of 0022 (Task 4's leftovers): `DROP POLICY IF EXISTS app_insert ON translations`, `DROP POLICY IF EXISTS app_insert ON translation_requests`, `DROP POLICY IF EXISTS public_read ON translation_requests`, `DROP FUNCTION IF EXISTS prune_translation_requests()`.

- [ ] **Step 1: Check the persistent databases first** (read-only, owner connection, `kando-dev` and `kando-main`): count rows violating each new check and duplicate non-null `payment_ref`s, e.g. `SELECT count(*) FROM bookings WHERE NOT (amount >= 0 AND (stop_amount IS NULL OR stop_amount <= amount) AND material_amount <= amount AND duration_min > 0 AND currency ~ '^[A-Z]{3}$')` and `SELECT payment_ref FROM bookings WHERE payment_ref IS NOT NULL GROUP BY 1 HAVING count(*) > 1`. Any hit: stop and report it to the owner (test data to clean, or a code bug that wrote it).
- [ ] **Step 2: Write the failing tests**: `db-migrations.int.spec.ts` `0022 creates every listed index` (every name above is in `pg_indexes`) and `rls-payments.int.spec.ts` (owner connection): `two bookings cannot share a payment_ref` (23505), `a currency 'eur' or 'EURO' is refused` (23514 on `bookings`, `quotes`, `ledger_entries`), `a stop amount above the amount is refused`, `a material amount above the amount is refused`, `a commission rate of 1 is refused`, `a zero duration is refused`.
- [ ] **Step 3: Run** `pnpm --filter web exec vitest run tests/db-migrations.int.spec.ts tests/rls-payments.int.spec.ts`: FAIL.
- [ ] **Step 4: Implement** the indexes and checks in the schema files (`index(...).where(sql\`…\`)`, `uniqueIndex`, `check`, `index(...).using('gist', sql\`(${t.location}::geography)\`)`), `pnpm db:generate`, read the generated SQL (expect only `CREATE INDEX` / `ADD CONSTRAINT` / `CREATE UNIQUE INDEX`; nothing dropped), append the four hand-written statements with `--> statement-breakpoint` separators.
- [ ] **Step 5: Run** the two specs, then the whole web suite once (`pnpm --filter web test`): PASS. A test that wrote an out-of-range amount or a lower-case currency is a test bug unless the domain can produce that value: if the domain can, report it instead of loosening the check.
- [ ] **Step 6: Try it on a copy of production:** create a Neon branch of `kando-main` (console or `neon branches create --parent kando-main`), run `DATABASE_URL=<its unpooled string> pnpm db:migrate`, check `\d bookings` shows the new constraints, delete the branch. Applying to `kando-dev` and `kando-main` happens in Task 9, with the owner's go-ahead.
- [ ] **Step 7: Commit** `feat(db): migration 0022, missing indexes and money constraints`.

### Task 7: Status-move guard for the app role (item 15)

**Files:**
- Modify: `packages/db/src/rls.ts` (new constant and function next to `BOOKING_TRIGGERS`; `INSERT_RULES`; `bookings_guard_status`), `packages/db/src/schema/bookings.ts:5-6` (comment)
- Test: `apps/web/tests/rls-bookings.int.spec.ts`

**Interfaces:**
- `export const APP_STATUS_MOVES: Record<'requests' | 'quotes' | 'bookings', Record<string, 'customer' | 'provider' | 'answerer'>>` (Task 7b: `'answerer'` replaced `'either'`; Stage B must use the answerer semantics), keys `'<from>><to>'`:
  - `requests`: `'open>quoted': 'provider'`, `'quoted>booked': 'customer'`
  - `quotes`: `'sent>superseded': 'provider'`, `'sent>accepted': 'customer'`
  - `bookings`: `'proposed>awaiting-payment': 'answerer'`, `'proposed>declined': 'answerer'` (only the side whose turn it is: the provider unless `counter_by = 'provider'`, then the customer), `'proposed>withdrawn': 'customer'`, `'awaiting-payment>withdrawn': 'customer'`
- Trigger function `app_status_guard()` (generated from the constant), `BEFORE UPDATE` on the three tables (triggers `requests_app_status_guard`, `quotes_app_status_guard`, `bookings_app_status_guard`): only when `current_user = 'app_user'` and the status changed; raises unless the move is listed and the caller is on the listed side. Side: customer when `to_jsonb(NEW)->>'customer_id' = app_current_user_id()` (quotes: the request's customer), provider when the row's `provider_id` is owned by the caller. Moves made on the owner connection (expiry, endings, additional tasks, staff) are not affected.
- `requests` (app role): `answer_by` may not change on UPDATE (raise in the same function).
- `bookings_guard_status` app-role branch adds: `pay_by` or `accepted_at` changes only with `proposed > awaiting-payment` and then `pay_by <= start_at AND accepted_at <= pay_by`; `answer_by`, `counter_by`, `start_at`, `duration_min`, `on_site` change only while `OLD.status = 'proposed'` (the counter and the answer).
- `INSERT_RULES`: `requests` adds `AND status = 'open'`; `quotes` adds `AND status = 'sent'`; `bookings` adds `AND status = 'proposed' AND pay_by IS NULL AND accepted_at IS NULL AND counter_by IS NULL`.
- **For Stage B:** a new move made **in the request transaction** (customer withdraws an open or quoted request; provider declines an open request; a quote-born booking that ends declined or withdrawn by a party reopens its request `booked > quoted` and its quote `accepted > sent`) needs one entry per move in `APP_STATUS_MOVES` and nothing else; a move made on the owner connection (the expiry path, which runs on `db`) needs no entry. A new status value (for example `requests.status = 'declined'`) also needs the `CHECK` widened in 0023 by the rule in Global Constraints.

- [ ] **Step 1: Write the failing tests** (`asUser` as each party on rows made by the helpers):
  - `app_user cannot make a status move the domain does not make`: provider `UPDATE requests SET status = 'booked'` rejects; customer `UPDATE requests SET status = 'quoted'` rejects; customer `UPDATE quotes SET status = 'superseded'` rejects; provider `UPDATE quotes SET status = 'accepted'` rejects; provider `UPDATE bookings SET status = 'withdrawn'` rejects; `UPDATE bookings SET status = 'proposed'` on an awaiting-payment booking rejects; inserting a request with status `'booked'`, a quote with `'accepted'`, a booking with `'awaiting-payment'` or a `pay_by` each reject.
  - `pay_by and the proposal columns move only with their transition`: customer `UPDATE bookings SET pay_by = start_at - interval '1 hour'` on a proposed booking (status unchanged) rejects; accepting with `pay_by = start_at + interval '1 day'` rejects; `UPDATE bookings SET start_at = …` on an awaiting-payment booking rejects; `UPDATE requests SET answer_by = …` rejects for both parties.
  - The real flows still pass: `tests/requests-quotes.int.spec.ts tests/bookings.int.spec.ts tests/additional-task.int.spec.ts tests/timers.int.spec.ts` unchanged.
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run tests/rls-bookings.int.spec.ts`: FAIL.
- [ ] **Step 3: Implement** as in Interfaces; update the comment in `schema/bookings.ts` ("status moves: rls.ts APP_STATUS_MOVES").
- [ ] **Step 4: Run** `rls-bookings` plus the four flow specs above plus `tests/rls.int.spec.ts tests/cancel.int.spec.ts tests/finish.int.spec.ts tests/disputes.int.spec.ts tests/payments.int.spec.ts`: PASS. A flow spec that fails names a move the domain makes on the app role that is missing from the list: add it only if the domain code really makes it there (and say so in the commit).
- [ ] **Step 5: Commit** `fix(db): app role may make only the status moves the domain makes`.

### Task 8: Atomic `applyRls` and the slug lock (items 18, 19)

**Files:**
- Modify: `packages/db/src/rls.ts:257-273` (`set_provider_published`), `rls.ts:513-516` (`applyRls`), `packages/db/src/migrate.ts` (comment)
- Test: `apps/web/tests/rls.int.spec.ts`, `apps/web/tests/publish-flow.int.spec.ts`

**Interfaces:**
- `applyRls(statements: string[] = rlsStatements()): Promise<void>` runs every statement in one `db.transaction` (the parameter exists for the test).
- `set_provider_published`: `PERFORM pg_advisory_xact_lock(hashtext('kando.slug'), hashtext(p_slug_base))` right before the `WHILE EXISTS` loop (only when a slug is assigned).
- `migrate.ts` doc comment: the migrator runs all pending files in one transaction (so no `CONCURRENTLY`), and the CHECK-widening rule from Global Constraints.

- [ ] **Step 1: Write the failing tests**:
  - `rls.int.spec.ts` `applyRls is all or nothing`: `await expect(applyRls([\`DROP POLICY owner_only ON "users"\`, 'SELECT no_such_function()'])).rejects.toThrow()`; then `pg_policies` still lists `owner_only` on `users`.
  - `publish-flow.int.spec.ts` `two providers with the same name publish at once`: two complete profiles whose public name slugifies to the same base; `Promise.all` of both publishes: both `ok`, slugs are `{base, base-2}`.
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run tests/rls.int.spec.ts tests/publish-flow.int.spec.ts`: FAIL (the policy is gone; one publish answers 500, or passes by luck: run the race test 5 times in a loop inside the test).
- [ ] **Step 3: Implement** as in Interfaces.
- [ ] **Step 4: Run** the two specs plus `tests/db-migrations.int.spec.ts tests/seeds.int.spec.ts`: PASS.
- [ ] **Step 5: Commit** `fix(db): apply row-level security atomically; serialise slug assignment`.

### Task 9: Full run, test report, README, databases

**Files:**
- Create: `Reports/Assessment-Stage-A-Test-Report.xlsx` (layout of `Reports/Stage-2e-Test-Report.xlsx`: summary, per-package results, Other Checks, Open Items)
- Modify: `README.md` (section "Stage 2 build progress": add an "Assessment fixes (30 October 2026)" table with rows A to D, A marked done with its pull request; "Database state" line: migration 0022)

- [ ] **Step 1: Run every package:** `pnpm --filter web test`, `pnpm --filter @kando/domain test`, `pnpm --filter @kando/contract test`, `pnpm --filter @kando/i18n test`, `pnpm --filter mobile test`; and `npx tsc --noEmit` in `packages/db`, `packages/domain`, `packages/contract`, `apps/web`, `apps/mobile`; `pnpm lint`. Expected: all pass, typecheck and lint clean. Paste the outputs (counts per package, typecheck results) into the report.
- [ ] **Step 2: Report contents:** per finding (5, 6, 8, 15, 16, 17, 18, 19) what changed and which test proves it; Other Checks: "migration 0022 on a Neon branch of kando-main" (Task 6 Step 6), "Preview under load: chat polling from two phones, no 10 s timeouts in the Vercel log"; Open Items: the owner decision on `attachDatabasePool`, `settle` kept under its lock, chat photos still stored inside the transaction, invoice PDFs stored inline (move with Inngest).
- [ ] **Step 3: Databases (owner's go-ahead first; the owner allowed direct production migrations during Stage 2):** `pnpm db:migrate` against `kando-dev`, then `kando-main` (owner connection, unpooled string). Record both in the README "Database state" line.
- [ ] **Step 4: Commit** `docs: Stage A assessment fixes report and README`, push, open the pull request into `release/assessment-fixes` (description without a "Generated with" line), leave the merge to the owner.

---

## Owner decisions

- **`attachDatabasePool` (Vercel Fluid compute):** closes idle pool clients before a function instance is suspended, so they do not linger until Neon drops them. Needs the new dependency `@vercel/functions`. This plan instead sets `idleTimeoutMillis: 5_000` and logs idle-client errors, which covers the crash and most of the leak. Say yes to add the dependency (one import in `client.ts`, one call per pool).

## Deliberately not changed

- `payments/settle.ts` keeps its Stripe refund and transfer calls under the booking row lock: the lock is what stops a second settlement, and the crash-safety table in its doc comment depends on it. It runs on the owner pool, so it no longer competes with request transactions; the Stripe client's 15 s timeout bounds it.
- Chat photos are still stored inside the request transaction (thread-bound key, membership check first).
- The owner-connection work inside request transactions (expiry on list, endings) stays: it is how the design writes staff-only columns; Task 1 makes it unable to starve the request pool. Stage B decides whether the list routes keep running the due timers.
