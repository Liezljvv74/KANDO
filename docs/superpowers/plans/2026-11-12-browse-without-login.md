# Browse Without Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person who is not logged in can browse services and read every document; anything that creates a transaction asks them to log in or sign up first and then brings them back.

**Architecture:** The tab area stops being locked behind the session guard (`apps/mobile/src/app/_layout.tsx`); the auth screens stay for signed-out people only. Public data is already served without a session (`auth: 'optional'` on search, provider profile, categories, help). Private screens are wrapped in one `signedInOnly` component that shows a "Log in or sign up to use this" prompt when there is no session. The existing "after login" memory (`lib/after-login.ts`) is extended so a signed-out "Request/Book" returns to the same provider page after login or sign-up.

**Tech Stack:** Expo SDK 58 + expo-router (`apps/mobile`), Next.js `app-api/v1` routes, `packages/i18n`, jest (mobile), vitest (web integration).

**Spec:** No separate spec; the decisions below (owner, 12 November 2026) are the spec. Start this branch from an updated `main`, **after** the Done-button pull request is merged (both touch `_layout.tsx`, `form-ui.tsx` and the tab screens). One branch, one PR; the owner merges.

## Global Constraints

- Every user-facing text in German and English (`packages/i18n`); German is the main language; `notification-parity.int.spec.ts` must stay green.
- The Welcome screen stays the first screen for a signed-out person. **Decided later (12 November, owner): it is the Home tab itself** (one screen, one route, the tab bar is always at the bottom); the separate `(auth)/welcome` route is removed, and back from login or sign-up returns to where the person came from. Its "I need help" card becomes **"Browse services"** (German **"Dienste durchsuchen"**) with its own text keys; the **signed-in Home keeps "I need help" unchanged** (the two cards stop sharing keys).
- **All tabs are visible when signed out.** Search, the provider page, Home, Learn and Help work fully. Jobs, My business, Account and every screen under bookings, invoices, threads and quotes show the prompt "Log in or sign up to use this" with a button to the login and sign-up page.
- No transaction (request, quote, booking, payment, message, review, upload) is possible without a session; the server refuses with 401, the app asks first.
- After login or sign-up the person returns to the **same provider page** (not to a half-filled form).
- Terms, Privacy and Legal notice: a small line of three links on exactly four screens: **Welcome (signed out), Login, Sign-up, Account**. Each opens the website page in the phone browser in the app's language (slugs `agb`, `datenschutz`, `impressum`; the existing `openPage` in `terms-checkbox.tsx` is the pattern). Link texts reuse `web.footer.terms`, `web.footer.privacy`, `web.footer.impressum`.
- Help stays reachable by everyone (it already is).
- No new Germany-only assumptions; no competitor names; no spinner anywhere (owner rule, 12 November: `ActivityIndicator` is not used in the app).
- Tests: per task only the affected specs and `tsc`; the full suites once at the end (integration specs one after another, `--fileParallelism=false`).
- No AI co-author lines in commits or the PR description. The owner merges; run `/code-review --comment` before the merge.

## Review Focus

- **Expired session on a private tab:** a signed-in person whose session ends sees the prompt, not a blank or crashing screen, and the 401 handler does not loop (signed-out requests carry no cookie, so `client.ts` must not clear or redirect).
- **Deep link while signed out** (`/bookings/<id>`, `/threads/<id>`, a push tap): shows the prompt; after login the person is not dumped on the prompt again.
- **Sign-up with email verification in between:** the stored return target survives closing the app while waiting for the code (SecureStore, 2 h limit) and is used once.
- **Stale or forged return target:** only `/search` or `/provider/<slug>` with a safe slug is accepted; anything else is ignored (the person lands on Home).
- **A person viewing their own profile or a signed-in provider:** Request/Book stays hidden on their own page; a signed-out person always sees the button.

---

### Task 1: Documents line (Terms, Privacy, Legal notice)

**Files:**
- Create: `apps/mobile/src/lib/legal-links.ts`, `apps/mobile/src/lib/legal-links.test.ts`, `apps/mobile/src/components/legal-footer.tsx`
- Modify: `apps/mobile/src/components/terms-checkbox.tsx` (use the shared opener), `apps/mobile/src/screens/home/home-screen.tsx` (signed out only), `apps/mobile/src/screens/auth/login-screen.tsx`, `apps/mobile/src/screens/auth/sign-up-screen.tsx`, `apps/mobile/src/screens/account-screen.tsx`

**Interfaces:**
- Produces: `legalUrl(slug: 'agb' | 'datenschutz' | 'impressum', lang: Lang, base?: string): string` and `openLegal(slug): void` in `legal-links.ts`; `<LegalFooter />` (no props) in `legal-footer.tsx`.

- [ ] **Step 1: Write the failing test** `legal-links.test.ts`: `legalUrl('agb','de','https://x')` equals `https://x/agb`; `legalUrl('impressum','en','https://x')` equals `https://x/impressum?lang=en`; `legalUrl('datenschutz','de','https://x')` equals `https://x/datenschutz`.
- [ ] **Step 2: Run** `pnpm --filter mobile exec jest legal-links`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `legalUrl` (default base `API_URL`, same pattern as `openPage`) and `openLegal` (`Linking.openURL(...).catch(() => {})`) in `legal-links.ts`; make `terms-checkbox.tsx` call `openLegal` instead of its private `openPage`.
- [ ] **Step 4: Implement `LegalFooter`**: a centred row of three small underlined links (`web.footer.terms`, `web.footer.privacy`, `web.footer.impressum`), `accessibilityRole="link"`, 44 pt touch height, muted ink colour, placed at the end of the scrolling content (not fixed). Calls `useLang()` so it re-renders on language switch.
- [ ] **Step 5: Place it** at the bottom of the content of: Welcome (only when signed out), login screen, sign-up screen, account screen. Not on any other screen.
- [ ] **Step 6: Run** `pnpm --filter mobile exec jest legal-links terms` and `pnpm --filter mobile exec tsc --noEmit`. Expected: PASS, no errors.
- [ ] **Step 7: Commit** `feat: Terms, Privacy and Legal notice links on Welcome, Login, Sign-up and Account`.

### Task 2: Server check, nothing writable without a session

**Files:**
- Create: `apps/web/tests/signed-out.int.spec.ts`
- Modify: only if the spec finds an open route (then that route's `appRequest` options)

**Interfaces:**
- Consumes: `appRequest({ auth: 'optional' | ... })` from `apps/web/lib/app-request.ts`; the default of `createAppRequest` in `packages/domain/src/app-request.ts` (confirm it is "session required").
- Produces: a spec that lists every `app-api/v1/**/route.ts`.

- [ ] **Step 1: Write the spec** `signed-out.int.spec.ts`: (a) read every route file under `apps/web/app/app-api/v1`; for each exported `POST`, `PUT`, `PATCH`, `DELETE` assert its `appRequest(...)` call does not contain `auth: 'optional'` unless the route is on an explicit allow-list (`feedback` POST, sign-in helpers, webhooks, the public translate or search-cache routes found in the audit; each allow-list entry carries a one-line reason); (b) call `GET /app-api/v1/providers`, `/categories?lang=en`, `/help?lang=en` and `/providers/<seeded slug>` without a cookie and expect 200; (c) call `POST /app-api/v1/requests` and `POST /app-api/v1/bookings` without a cookie and expect 401.
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run tests/signed-out.int.spec.ts --fileParallelism=false`. Expected: PASS; a failure names the open route, which is then fixed (require the session) in this task.
- [ ] **Step 3: Commit** `test: no write route works without a session`.

### Task 3: Open the tabs to signed-out people, "Browse services" card

**Files:**
- Modify: `apps/mobile/src/app/_layout.tsx`, `apps/mobile/src/screens/home/home-screen.tsx`, `packages/i18n/src/en.ts`, `packages/i18n/src/de.ts`, `apps/mobile/src/app/(tabs)/_layout.tsx` (only if it assumes `me`)
- Test: `apps/mobile/src/lib/home-choices.test.ts` if the choice list is extracted; otherwise the manual check in Task 6

**Interfaces:**
- Produces: texts `welcome.browse` ("Browse services" / "Dienste durchsuchen") and `welcome.browseText` ("Look through providers near you and see what they offer." / "Stöbere durch Anbieter in deiner Nähe und sieh, was sie anbieten."). `welcome.needHelp` and `welcome.needHelpText` stay, used only by the signed-in Home.

- [ ] **Step 1:** In `app/_layout.tsx` remove the `Stack.Protected guard={!!user}` around `(tabs)` (keep the `(auth)` guard `!user`, so a signed-in person still cannot open the auth screens). Keep the comment about the SDK 58 redirect accurate or delete it.
- [ ] **Step 2:** In `home-screen.tsx` the signed-out `needHelp` choice becomes `{ title: 'welcome.browse', text: 'welcome.browseText', onPress: () => router.navigate('/search'), main: true }` (no `setAfterLogin`, no sign-up). The signed-in list is unchanged.
- [ ] **Step 3:** Read `(tabs)/_layout.tsx`, `search-screen.tsx` and `provider-screen.tsx` for anything that requires `me` (a `useMe()` result used without a null check, a `loadMe()` that signs out on 401) and make each work signed out (a signed-out `loadMe` must not run).
- [ ] **Step 4:** Add the two new text keys in `en.ts` and `de.ts`.
- [ ] **Step 5: Run** `pnpm --filter mobile exec tsc --noEmit` and `pnpm --filter @kando/i18n test`. Expected: PASS.
- [ ] **Step 6: Commit** `feat: signed-out people can open the tabs; Welcome card "Browse services"`.

### Task 4: "Log in or sign up to use this" on the private screens

**Files:**
- Create: `apps/mobile/src/components/signed-in-only.tsx`
- Modify: `apps/mobile/src/app/(tabs)/jobs.tsx`, `account.tsx`, `my-profile/_layout.tsx`, `bookings/_layout.tsx`, `invoices/_layout.tsx`, `threads/_layout.tsx`, `quotes/index.tsx` (wrap each), `packages/i18n/src/en.ts`, `de.ts`
- Test: `apps/mobile/src/components/signed-in-only.test.tsx` only if the app's jest setup can render components (CLAUDE.md note: no component-test library, so otherwise a pure helper `needsLogin(user)` is tested and the rest is checked by hand in Task 6)

**Interfaces:**
- Produces: `signedInOnly<P>(Screen: ComponentType<P>): ComponentType<P>`; texts `auth.needLogin` ("Log in or sign up to use this" / "Melde dich an oder registriere dich, um dies zu nutzen") and `auth.needLoginButton` ("Log in or sign up" / "Anmelden oder registrieren").

- [ ] **Step 1:** `signedInOnly` reads `useSession().user`; with a user it renders `Screen`; without one it renders the prompt: the `auth.needLogin` text and a button (`auth.needLoginButton`) that calls `router.push('/login')`. The Account screen's prompt also shows `<LegalFooter />` (Task 1 places it on Account for both states).
- [ ] **Step 2:** Wrap the seven route files listed above with it.
- [ ] **Step 3:** Add the texts in both languages.
- [ ] **Step 4: Run** `pnpm --filter mobile exec tsc --noEmit` and `pnpm --filter mobile exec jest signed-in-only`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: private screens ask signed-out people to log in or sign up`.

### Task 5: Request and Book ask for a login and return to the provider

**Files:**
- Modify: `apps/mobile/src/lib/after-login.ts`, `apps/mobile/src/lib/after-login.test.ts`, `apps/mobile/src/screens/provider/request-actions.tsx`, `apps/mobile/src/screens/home/home-screen.tsx` (the `consumeAfterLogin` use), `apps/mobile/src/app/(tabs)/bookings/new-request.tsx` (guard for deep links)

**Interfaces:**
- Produces: `type AfterLogin = '/search' | \`/provider/${string}\``; `setAfterLogin(t: AfterLogin | null): Promise<void>`; `consumeAfterLogin(): Promise<AfterLogin | null>`; `isAfterLogin(v: string): v is AfterLogin` (accepts `/search` or `/provider/` followed by `[a-z0-9-]{1,80}` only).

- [ ] **Step 1: Write failing tests** in `after-login.test.ts`: `isAfterLogin('/provider/anna-schmidt')` true; `isAfterLogin('/provider/../x')`, `isAfterLogin('https://evil')`, `isAfterLogin('/jobs')` false; a stored `/provider/anna|<now>` is returned once and then `null`; one older than 2 h returns `null`.
- [ ] **Step 2: Run** `pnpm --filter mobile exec jest after-login`. Expected: FAIL.
- [ ] **Step 3: Implement** the widened type and `isAfterLogin`; `consumeAfterLogin` returns the target only when `isAfterLogin` and fresh.
- [ ] **Step 4:** `useCanRequest(slug)` returns `true` when there is no session (the button shows to signed-out people); the signed-in rules are unchanged. `RequestButton`'s `onPress`, when signed out, calls `setAfterLogin(\`/provider/${provider.slug}\`)` then `router.push('/login')`; signed in, it keeps `go(target.path, target.params)`.
- [ ] **Step 5:** In `home-screen.tsx` the `consumeAfterLogin().then(dest => ...)` navigates to `dest` (was hard-coded `/search`), still skipped when `peekPending()`.
- [ ] **Step 5b (owner testing feedback, 12 November: a new customer landed on Home, not Search):** in `verify-email-screen.tsx`, a person who did not tick "offer services" goes after the code to `(await consumeAfterLogin()) ?? '/search'` (`router.replace`), not to `/`; people who offer services keep `startOffering(true)`. Add a pure helper `afterVerifyTarget(offerServices: boolean, stored: AfterLogin | null): AfterLogin | null` in `lib/after-login.ts` (null = the offering flow decides) with tests: `(false, null)` gives `/search`; `(false, '/provider/anna')` gives `/provider/anna`; `(true, anything)` gives `null`.
- [ ] **Step 6:** `bookings/new-request.tsx` is already wrapped by Task 4; confirm a signed-out deep link shows the prompt and does not render the form.
- [ ] **Step 7: Run** `pnpm --filter mobile exec jest after-login request-target` and `pnpm --filter mobile exec tsc --noEmit`. Expected: PASS.
- [ ] **Step 8: Commit** `feat: Request and Book ask signed-out people to log in and bring them back`.

### Task 6: Check, README, hand over

**Files:**
- Modify: `README.md` ("Where we are" and RESUME HERE: what changed, how to test)

- [ ] **Step 1:** Run once: `pnpm --filter mobile exec jest`, `pnpm --filter @kando/i18n test`, `pnpm typecheck`, `pnpm lint`, then `pnpm --filter web exec vitest run --fileParallelism=false` (the dev Neon branch; integration specs one after another).
- [ ] **Step 2: Manual check in the browser preview** (the `test/web-harness-*` worktree, production, test accounts only): signed out: Welcome shows "Browse services" and the three-link line; the card opens Search; all five tabs show; Jobs, My business and Account show the prompt with a working button; a provider page shows Request/Book; tapping it goes to login, and after login the same provider page opens; same through sign-up and the email code; Terms, Privacy and Legal notice open in the browser in German and English; signed in: Home is unchanged ("I need help"), Account shows the line, Request on one's own profile is still hidden.
- [ ] **Step 3:** Update the README, commit `docs: README, browse without login`, and tell the owner: push and PR only when she says so; then `/code-review --comment`, fix, remind her to submit a GitHub review (Approve); she merges; then a new EAS Android build.

## Self-review

- Spec coverage: browse without login (Tasks 3, 4), tabs all visible with prompt and link (Tasks 3, 4), no transaction without login (Tasks 2, 5), documents readable by all (Task 1; Help unchanged), footer on Welcome, Login, Sign-up, Account only (Task 1), return to the provider page (Task 5), signed-in Home unchanged (Task 3).
- Open facts to confirm while building: that `createAppRequest` defaults to "session required" (Task 2); whether the app's jest setup can render components (Task 4); the exact `/login` route name (`(auth)/login`).
