# Terms acceptance: follow-ups from the review of #73

Status: plan only, nothing built. Source: the `/code-review --comment` of PR #73 (4 November 2026), findings that were accepted for later. Migration 0031 (`users.terms_accepted_at`) and the sign-up checkbox are merged and live.

Where it fits in the MVP plan: after step 1.7 (Flow 1 test report) and before step 3.1 (security and compliance scan). Suggested new step **2.7 "Terms acceptance for everyone"** (Claude, size M) for PR A, and **3.0 "Sign-up cleanups"** (Claude, size S) for PRs B and C. The owner confirms the numbers before `mvp_plan.py` is changed.

## Order and size

| PR | What | Size | Migration | Depends on |
|----|------|------|-----------|------------|
| A | Terms version, gate for accounts without a current acceptance, accept screen in the app | M | 0032 | owner publishes the legal pages with a version label |
| B | Checkbox text with real links, readable by a screen reader | S | none | none |
| C | `finish()` and the pending sign-up record in one place | S | none | none (do before A touches `finish()`) |

Do **C first** (it is a refactor with no behaviour change and A builds on it), then A, then B. B can run in parallel with A (different files).

## PR C: one place for the pending sign-up record (finding 4)

Problem: `use-session.ts` `finish()` rebuilds the pending record (`pending-signup.ts`) in several branches (terms first, profile next, drop on permanent 4xx, keep on 408/429/5xx).

Tasks
1. Write a small pure function in `apps/mobile/src/lib/pending-signup.ts`: `nextPending(record, step, outcome)` returns the record to keep, or null. The outcome is `ok`, `permanent` (4xx except 408 and 429) or `retry`.
2. `finish()` calls it once per step instead of building the record by hand.
3. Move the existing cases from `use-session.test.ts` to test the pure function directly (table of step by outcome), keep the three integration-style cases.

Done when: mobile tests pass with no changed expectation; `finish()` has one exit path for the record; diff shows only the refactor.

## PR A: terms version and a gate for everyone (findings 1, 2, 3)

Decisions to make before building (owner)
- **A1.** What happens to an account without a current acceptance? Recommended: it can read and browse, but every write (request, quote, booking, upload, chat message) answers `428 terms-required` until the person accepts in the app. Alternative: a full-screen block on app start only. Recommended is the server gate, because the app check alone can be skipped (that was finding 2).
- **A2.** Version label format. Recommended: the date the text took effect, for example `2026-11-15`, set in one constant in `packages/contract/src/terms.ts` and the same label shown at the bottom of the published page ("Stand / As of").
- **A3.** Changes to the terms give a 30-day notice by email (terms section 10). Recommended: this PR does not send the email; the owner sends it by hand the first time. The gate only starts to apply when the version constant is raised.

Tasks (after A1 to A3)
1. **Migration 0032:** `users.terms_version text` (nullable). No backfill of old accounts: they stay empty so the gate and the AI check treat them as not accepted (a made-up acceptance is worse). `pnpm db:generate --name`, dev, then production before the code is deployed. Existing column `terms_accepted_at` stays as the time of the last acceptance.
2. **Contract:** `TERMS_VERSION` constant; `MePatchSchema.termsAccepted` becomes `termsVersion: z.literal(TERMS_VERSION)` (keep accepting `termsAccepted: true` for one release so an older app build still signs up; it records the current version).
3. **Domain `updateMe`:** write `terms_accepted_at = now()` and `terms_version` when the version in the patch is the current one. Overwrite on re-acceptance (the time of the last acceptance is what counts; the history goes in the audit log if one exists for `users`, otherwise note it as a limit).
4. **Gate:** in `createAppRequest` (`packages/domain/src/app-request.ts`), for non-GET requests, read the caller's `terms_version` with the session lookup that already runs; if it differs from `TERMS_VERSION`, answer `428` with code `terms-required`. Allow-list: `PATCH /me` (the accept call), `DELETE /me` (account deletion must always work), `GET /me/export`, and the auth routes. Cost check: reuse the user row already loaded for the session, no extra query (verify; if it needs one, cache per request).
5. **App:** on `428 terms-required` the API client opens an accept screen (new `screens/auth/accept-terms-screen.tsx`) with the same checkbox and links as sign-up (share the component from PR B), a "Not now" that leaves the browse-only app, and the "Delete my account" path visible. Both languages; error text names the problem and the action (project rule).
6. **AI check:** `document-check.ts` requires `terms_version = TERMS_VERSION` instead of only a non-null `terms_accepted_at`. When it fails, the staff text `admin.ai.failure.terms-not-accepted` stays.
7. **Export and deletion:** `termsVersion` in the user export (`export.ts`); account deletion already removes the user row.
8. **Tests:** integration spec for the gate (accepted user passes, empty user gets 428 on a write and passes on a read, allow-listed routes pass); `terms-accepted.int.spec.ts` extended for the version; AI check spec for the stale version; mobile test for the 428 handler; `notification-parity` unaffected (no new notice).
9. **Legal pages:** owner publishes `agb` and `datenschutz` with the version label before this PR is merged; the order is publish, then raise nothing (the constant starts at the label of the published text).

Done when: an account created before #73 can browse, is stopped on its first write with a clear German or English message, accepts once, and is never asked again until `TERMS_VERSION` changes; the AI check skips stale accounts; full web suite green (CI runs everything).

Risks: the gate is a new failure mode on every write route, so run the full web suite before pushing (the cron-route test in #70 failed in CI for a similar reason). Test accounts created by seed helpers must get the current version (`helpers.ts` `seedUser`).

## PR B: checkbox links and screen reader text (findings 5 and part of 4)

Problem: the sentence is assembled from five German or English fragments in `auth.terms*` keys; word order differs between languages, and a screen reader reads the whole row as one checkbox, so the two links cannot be reached separately.

Tasks
1. Extract the row into `apps/mobile/src/components/terms-checkbox.tsx`, used by the sign-up screen and later by the accept screen of PR A.
2. Replace the five fragments with two keys: one sentence with `{terms}` and `{privacy}` placeholders (`auth.termsSentence`) and the two link labels; split on the placeholders in the component. Remove the old fragment keys from `de.ts` and `en.ts`.
3. Accessibility: the checkbox is its own element (`accessibilityRole="checkbox"`, state checked, label = the whole sentence without link words), each link is its own `accessibilityRole="link"` with a label that says it opens in the browser, minimum touch target 44 px.
4. Test: render in both languages and assert the order and that both links call `openPage` with the right page; one accessibility-props test.

Done when: German and English read naturally, a screen reader can focus the checkbox and each link separately, and no `auth.terms*` fragment key is left unused.

## Not planned here

- Re-sending the terms by email on every change (A3): by hand for now.
- Server-side block at Neon Auth sign-up: not possible with Managed Better Auth; PR A's gate is the replacement.
