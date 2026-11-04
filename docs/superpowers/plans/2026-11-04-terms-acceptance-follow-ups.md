# Terms acceptance: follow-ups from the review of #73

Status: PRs C and B are merged (#77, #78); PR A (step 2.7) is built on branch `feat/terms-reacceptance` (see "What was built" at the end). Source: the `/code-review --comment` of PR #73 (4 November 2026), findings that were accepted for later. Migration 0031 (`users.terms_accepted_at`) and the sign-up checkbox are merged and live.

Where it fits in the MVP plan: after step 1.7 (Flow 1 test report) and before step 3.1 (security and compliance scan). Suggested new step **2.7 "Terms acceptance for everyone"** (Claude, size M) for PR A, and **3.0 "Sign-up cleanups"** (Claude, size S) for PRs B and C. The owner confirms the numbers before `mvp_plan.py` is changed.

## Order and size

| PR | What | Size | Migration | Depends on |
|----|------|------|-----------|------------|
| A | Terms version, pop-up and server backstop when the terms change | M | 0032 | owner publishes the legal pages with a version label |
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

## PR A: terms version and a gate for everyone (findings 1, 2, 3; scope reduced by the owner on 4 November)

Owner decisions (4 November 2026)
- **A1.** Registration is impossible without accepting the terms (the sign-up checkbox, already built). Old accounts are test accounts only and will be deleted, so **no gate and no special handling for them**. Document rules are unchanged: a customer needs no documents; a provider can publish a service only after an approved ID.
- **A2.** The version label is the date the text took effect, for example `2026-11-15`, one constant in `packages/contract/src/terms.ts`, shown on the published page too.
- **A3.** No emails. When the terms change (the constant is raised), a **pop-up appears in the app** and the person must accept the new terms before continuing. Terms section 10 (German and English) must be reworded to say this instead of the 30-day email; the owner or Claude edits the unpublished drafts in the back office before publishing.

Tasks
1. **Migration 0032:** `users.terms_version text` (nullable). No backfill. `pnpm db:generate --name`, dev, then production before the code is deployed.
2. **Contract:** `TERMS_VERSION` constant; the accept call sends `termsVersion` (the sign-up call keeps `termsAccepted: true` and records the current version).
3. **Domain `updateMe`:** on accepting the current version write `terms_accepted_at = now()` and `terms_version`. Re-acceptance overwrites (the last acceptance counts).
4. **Pop-up:** the app reads `termsVersion` from `GET /me`; when it differs from `TERMS_VERSION` a modal (shared checkbox and links from PR B, button "Accept and continue") blocks the app until accepted. A "Delete my account" link stays visible in the modal. Texts in German and English, naming the problem and the action.
5. **Server backstop:** for non-GET requests, `createAppRequest` answers `428 terms-required` while the caller's version is not current (allow-list: accept call, account deletion, export, auth routes), so a modified app cannot skip the pop-up. Reuse the user row already loaded for the session, no extra query (verify).
6. **AI check:** `document-check.ts` requires the current version; failure text `admin.ai.failure.terms-not-accepted` stays.
7. **Export:** `termsVersion` in the user export (`export.ts`).
8. **Tests:** gate spec (current version passes; stale version gets 428 on a write, passes on a read and on the allow-list); `terms-accepted.int.spec.ts` for the version; AI check spec for a stale version; mobile test for the pop-up and the 428 handler; `helpers.ts` `seedUser` sets the current version.
9. **Legal pages:** owner publishes `agb` and `datenschutz` with the version label before the merge; the constant starts at that label.

Done when: after `TERMS_VERSION` is raised, a signed-in test account sees the pop-up, cannot write until it accepts, and is not asked again until the next change; the AI check skips stale accounts; full web suite green (CI runs everything).

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

- Emails about terms changes: decided against (A3); the pop-up replaces them.
- A gate or backfill for old accounts: they are test accounts and will be deleted.
- Server-side block at Neon Auth sign-up: not possible with Managed Better Auth; PR A's gate is the replacement.


## What was built for PR A (step 2.7, 5 November 2026)

- **Migration 0033** `users.terms_version text` (nullable, no backfill). Migration 0032 became the date of birth (ID scan), so the number moved.
- **`TERMS_VERSION`** in `packages/contract/src/terms.ts`, set to `2026-11-04` for now. **The owner gives the real date when she publishes the pages; raise the constant to it in the same pull request or just before.** Raising it later shows everybody the pop-up again.
- **Who is held back:** a person who accepted before (`terms_accepted_at` set) but not the current version (`termsRequired` in `GET /me`, `termsStale` on the session user). An account that never accepted (old test accounts) is not held back, as decided (A1). Accounts that accepted through #73 have no version and see the pop-up once.
- **Server backstop:** every write except `PATCH /me` and `DELETE /me` answers `428 terms-required` while the version is stale (`allowStaleTerms` on the route options; reads and the export still work).
- **Accepting:** `PATCH /me {termsAccepted:true, termsVersion}`; the time and version are stored; a repeat of the same version keeps the first time; an older app text gets `409 terms-outdated`.
- **AI features:** the document check and the ID scan need the current version.
- **App:** `TermsReaccept` modal over the whole app (`terms-reaccept.tsx`), reload of `/me` on a 428, "I do not agree" sets the pop-up aside and opens the account page (delete account there); a refused write brings it back.
- **Tests:** `terms-version.int.spec.ts` (gate, accept, outdated app, never-accepted), AI check with a stale version, mobile client 428 and `use-me`.
- **Not built:** a delete-account button inside the pop-up (the account page has it).
