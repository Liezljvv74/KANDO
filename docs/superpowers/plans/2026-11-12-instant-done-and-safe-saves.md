# Instant Done Button and Saves That Are Never Lost: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Done opens the next screen at once; every change on the Account, About you and Service screens is kept on the phone and retried until the server accepts it, with a banner on every screen that says what is not saved and why.

**Architecture:** One persisted "pending saves" store (a JSON file on the phone) holds the newest unconfirmed value of each field, per signed-in account. A runner retries entries in the background (also after the screen is gone, after a restart, and when the app returns to the front). A banner mounted once in the root layout reads the store. The Done flow stops waiting for the server: it sends unsaved fields without waiting and picks the next step from data the phone already holds.

**Tech Stack:** Expo SDK 58 / React Native, `expo-file-system` (the new `File`/`Paths` API, already a dependency), expo-router, jest (`apps/mobile`).

**Spec:** `docs/superpowers/specs/2026-11-12-instant-done-and-safe-saves-design.md` (approved by the owner, 12 November 2026). Branch: `feat/done-button` (pull request #134 is open); follow-up commits on it.

## Global Constraints

- Applies to Account details, About you and Service fields only. Documents, photos, Jobs, chat and bookings are out of scope.
- Done never waits for the server; the text "Saved" is removed; the one-second pause is removed. The "Almost there! Please fill in: ..." message stays and stays instant.
- A change is removed from the store only when the server accepted it. Last change wins per entry. An entry belongs to one account id and is never sent as another account.
- Failure classes (from `ApiError.status`): **refused** = 4xx except 401, 403, 408, 428, 429; **wait for sign-in** = 401; **wait for the person** = 403 and 428; **retry** = status 0 (network), 408, 429, 5xx. A 404 on a service counts as refused.
- Retry schedule (builder's call): 2, 5, 15 and 45 seconds after a failure, then every 60 seconds while the app is in front, plus when the app returns to the front and once at start. (`expo-file-system` and `AppState` are what the app has; there is no connectivity library and none is added.)
- The banner is not dismissible while an entry is pending. It disappears by itself when the store is empty.
- Every user-facing text in German and English (`packages/i18n`), German is the main language. No spinner anywhere. `pnpm lint` must stay clean. No AI co-author lines. Per task: only the affected specs and `tsc`; the full suites once in Task 8.

## Review Focus

- **Two writers for one field:** the screen's own saver and the background runner must not send a stale value over a newer one (version number per entry; a success only clears the entry if its version is still the newest).
- **Account switch:** sign-out while entries are pending, or a different person signing in on the same phone: entries of another account are never sent and are dropped only after the person confirmed sign-out.
- **A refused value that the person corrects:** the entry must be replaced, retried, and the banner and the field error must clear; a refused entry must survive an app restart and still show its field error when the screen opens.
- **An unreadable or corrupted queue file:** the app starts normally with an empty queue (never crashes at start).
- **The service created offline:** a field typed before the create succeeded is sent with the real id afterwards and never against the temporary id; deleting the pending service drops its entries.

---

### Task 1: The pending-saves store

**Files:**
- Create: `apps/mobile/src/lib/pending-saves.ts`, `apps/mobile/src/lib/pending-saves.test.ts`

**Interfaces:**
- Produces:
  - `type SaveKind = 'about' | 'service-field' | 'service-create' | 'account'`
  - `type PendingEntry = { key: string; kind: SaveKind; accountId: string; body: unknown; serviceRef?: string; route: string; field: string; version: number; state: 'retry' | 'refused' | 'auth' | 'waiting'; reason?: string; attempts: number }` (`serviceRef` is a service id or a temporary id `tmp:<n>`; `route` is where the banner takes the person; `field` names the field for the error text)
  - `classifyFailure(e: unknown): 'retry' | 'refused' | 'auth' | 'waiting'` (the table in Global Constraints)
  - `putEntry(e: Omit<PendingEntry, 'version' | 'attempts' | 'state'>): number` (replaces the entry with the same `key`, returns the new version)
  - `clearIfVersion(key: string, version: number): void`, `markFailed(key: string, version: number, e: unknown): void`
  - `listEntries(accountId?: string): PendingEntry[]`, `dropAccount(accountId: string): void`
  - `loadStore(): Promise<void>` (reads the file once at start; a missing, unreadable or invalid file gives an empty store), `subscribe(fn: () => void): () => void`, `usePendingEntries(): PendingEntry[]`

- [ ] **Step 1: Write the failing tests** in `pending-saves.test.ts` (the file layer mocked with an in-memory string): `putEntry` twice with the same key keeps one entry and the second version is higher; `clearIfVersion` with an old version does nothing, with the newest removes it; `classifyFailure` returns `'refused'` for `new ApiError(400, 'Invalid postcode')` and `new ApiError(404, 'Not found')`, `'auth'` for 401, `'waiting'` for 403 and 428, `'retry'` for status 0, 408, 429 and 503; `markFailed` sets state and reason and increments attempts; `dropAccount('a')` leaves the entries of `'b'`; after `loadStore()` from a written file the entries are back (a restart); `loadStore()` with the text `'{not json'` gives an empty list and does not throw.
- [ ] **Step 2: Run** `pnpm --filter mobile exec jest pending-saves` (Expected: FAIL, module missing).
- [ ] **Step 3: Implement** the module: one in-memory map persisted after every change (debounced to the next tick, written with `new File(Paths.document, 'pending-saves.json').write(JSON.stringify(...))`, the same `File` class `use-session.ts` imports); listeners notified on change; `usePendingEntries` via `useSyncExternalStore`.
- [ ] **Step 4: Run** the same command. Expected: PASS. Run `pnpm --filter mobile exec tsc --noEmit`.
- [ ] **Step 5: Commit** `feat: the pending-saves store (kept on the phone, per account)`.

### Task 2: The runner (retries in the background)

**Files:**
- Create: `apps/mobile/src/lib/pending-runner.ts`, `apps/mobile/src/lib/pending-runner.test.ts`
- Modify: `apps/mobile/src/app/_layout.tsx` (start the runner once)

**Interfaces:**
- Consumes: Task 1 (`listEntries`, `clearIfVersion`, `markFailed`, `classifyFailure`, `loadStore`).
- Produces:
  - `registerSender(kind: SaveKind, send: (e: PendingEntry) => Promise<void>): void`
  - `sendNow(key: string): Promise<'ok' | 'failed'>` (one attempt for one entry, serialised per key)
  - `startRunner(getAccountId: () => string | null): () => void` (loads the store, retries entries of the signed-in account on the schedule, on `AppState` 'active', and at start; returns the stop function)

- [ ] **Step 1: Write failing tests** with jest fake timers and a fake sender: a retryable failure is tried again after 2 s, then 5 s, 15 s, 45 s, then every 60 s; a refused failure stops retrying (state `'refused'`) and is not tried again until the entry is replaced; an `'auth'` entry waits and is sent once `getAccountId()` returns the same account; an entry of another account is never sent; two entries of one `serviceRef` are sent in the order they were put; a success clears the entry only if the version is still the newest (a newer value put during the send is sent next); two calls of `sendNow` for one key never overlap.
- [ ] **Step 2: Run** `pnpm --filter mobile exec jest pending-runner` (Expected: FAIL).
- [ ] **Step 3: Implement** `registerSender`, `sendNow` and `startRunner` as above; an entry whose kind has no registered sender is left alone.
- [ ] **Step 4: Run** the spec and `tsc`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: background retries for pending saves`.

### Task 3: Field saves go through the store (About you, Service)

**Files:**
- Modify: `apps/mobile/src/hooks/use-field-save.ts`, `apps/mobile/src/screens/my-profile/about-screen.tsx`, `apps/mobile/src/screens/my-profile/service-screen.tsx`, `apps/mobile/src/hooks/use-field-save.test.ts`

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: `useFieldSave(initial, save, delayMs?, queue?)` where `queue?: { key: string; kind: SaveKind; accountId: string; route: string; field: string; serviceRef?: string; toBody: (v: V) => object | null }`. With `queue`, every send first `putEntry`s the value (the persisted copy), and a success calls `clearIfVersion`; a failure calls `markFailed` and still reports `'error'` as today. `dispose()` and `flushNow()` keep sending as today and now leave a persisted entry behind when the send did not finish.

- [ ] **Step 1: Write failing tests** in `use-field-save.test.ts` (on `createFieldSaver`): a failed save leaves the entry in the store with state `'retry'`; a later success of a newer value clears it; after `dispose()` with a failing save the entry is still in the store; a refused failure (400) marks the entry `'refused'` with the error code as `reason`.
- [ ] **Step 2: Run** `pnpm --filter mobile exec jest use-field-save` (Expected: FAIL).
- [ ] **Step 3: Implement** the `queue` option in `createFieldSaver` (no behaviour change when it is absent); pass it from the `useField` helpers in `about-screen.tsx` (kind `'about'`, key `about:<field>`, route `/my-profile/about?focus=<field>`) and `service-screen.tsx` (kind `'service-field'`, key `service:<serviceRef>:<field>`, route the service's edit screen). Register senders (`saveMyProfile(body)` for `'about'`; `servicesApi.update(serviceRef, body)` for `'service-field'`) once at app start in `_layout.tsx`.
- [ ] **Step 4: Run** the spec, the screens' existing specs and `tsc`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: About you and Service fields are kept and retried when a save fails`.

### Task 4: The category choice of a new service is queued

**Files:**
- Modify: `apps/mobile/src/lib/serial-create.ts`, `apps/mobile/src/lib/serial-create.test.ts`, `apps/mobile/src/screens/my-profile/service-screen.tsx`, `apps/mobile/src/lib/pending-runner.ts`

**Interfaces:**
- Consumes: Tasks 1 to 3.
- Produces: kind `'service-create'` (body `{ categoryId }`, `serviceRef` a temporary id `tmp:<n>`); in the runner, when a `'service-create'` entry succeeds the real id replaces `tmp:<n>` in every pending entry that carries that `serviceRef` (their keys too), and listeners are notified so an open Service screen can swap its id.

- [ ] **Step 1: Write failing tests:** the runner sends the create first, then the dependent field entries with the real id (never with `tmp:`); a failed create keeps the dependents waiting and unsent; two category changes before the create succeeds leave one create entry with the newest category; `dropService(tmpOrId)` removes the service's entries.
- [ ] **Step 2: Run** `pnpm --filter mobile exec jest serial-create pending-runner` (Expected: FAIL).
- [ ] **Step 3: Implement** the entry type in the runner and the id replacement in the store (`replaceServiceRef(from: string, to: string): void`); in `service-screen.tsx` `chooseCategory` puts a `'service-create'` entry when the create fails (it keeps the temporary id and shows the service as chosen); the screen swaps to the real id when told.
- [ ] **Step 4: Run** the specs and `tsc`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: the category choice of a new service is kept and retried`.

### Task 5: Account details as one queued entry

**Files:**
- Modify: `apps/mobile/src/screens/account-screen.tsx`, `apps/mobile/src/lib/account-autosave.ts`, `apps/mobile/src/lib/account-autosave.test.ts`

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: kind `'account'`, key `account`, body the same object `saveNow` sends to `updateMe` (names, address, birth date), route `/account`, field the first refused field name from `ApiError.fields` or `'details'`; registered sender `updateMe(body)`.

- [ ] **Step 1: Write failing tests** in `account-autosave.test.ts` for a pure helper `accountEntryBody(values): object` equal to the body `saveNow` builds today, and for `refusedField(e: ApiError): string` (`'Invalid postcode'` gives `'postcode'`, `fields: ['birthDate']` gives `'birthDate'`, otherwise `'details'`).
- [ ] **Step 2: Run** `pnpm --filter mobile exec jest account-autosave` (Expected: FAIL).
- [ ] **Step 3: Implement** the helpers; `saveNow` puts the entry before `updateMe`, clears it on success, marks it failed otherwise (silent saves on leaving the screen included).
- [ ] **Step 4: Run** the spec and `tsc`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: account details are kept and retried when a save fails`.

### Task 6: The banner

**Files:**
- Create: `apps/mobile/src/components/pending-banner.tsx`, `apps/mobile/src/lib/pending-banner-state.ts`, `apps/mobile/src/lib/pending-banner-state.test.ts`
- Modify: `apps/mobile/src/app/_layout.tsx` (mount it above the stack), `packages/i18n/src/en.ts`, `packages/i18n/src/de.ts`

**Interfaces:**
- Consumes: Task 1 (`usePendingEntries`).
- Produces: `bannerState(entries: PendingEntry[]): null | { kind: 'retry'; reason: 'network' | 'busy' } | { kind: 'refused'; count: number; first: PendingEntry }` (refused wins over retry; `first` is the oldest refused entry; `reason` is `'network'` for status 0 and `'busy'` otherwise). Texts: `pending.retryNetwork` ("Your changes are not saved yet: no connection. We keep them and try again."), `pending.retryBusy`, `pending.refused` ("{n} changes need your attention: tap to fix."), and the field error texts reuse `errorText(entry.reason)`.

- [ ] **Step 1: Write failing tests** for `bannerState`: empty list gives `null`; one retryable entry with status 0 gives `{ kind: 'retry', reason: 'network' }`; a 503 gives `'busy'`; a refused plus a retryable gives the refused state; two refused give `count: 2` and the older one as `first`.
- [ ] **Step 2: Run** `pnpm --filter mobile exec jest pending-banner-state` (Expected: FAIL).
- [ ] **Step 3: Implement** the helper and the component (a bar at the top, under the status bar, above every screen; tapping the refused state calls `router.push(first.route)`); mount it in `_layout.tsx`; add the German and English texts.
- [ ] **Step 4: Run** the spec, `pnpm --filter @kando/i18n test` and `tsc`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: a banner on every screen says what is not saved and why`.

### Task 7: Done is instant

**Files:**
- Create: `apps/mobile/src/lib/flow-cache.ts`, `apps/mobile/src/lib/flow-cache.test.ts`
- Modify: `apps/mobile/src/hooks/use-done.ts`, `apps/mobile/src/lib/done-flow.ts`, `apps/mobile/src/lib/done-flow.test.ts`, `apps/mobile/src/lib/flow-state.ts`, `apps/mobile/src/components/done-bar.tsx`, `apps/mobile/src/screens/my-profile/about-screen.tsx`, `service-screen.tsx`, `account-screen.tsx` (their `useDone` calls)

**Interfaces:**
- Consumes: Tasks 1 to 3.
- Produces: `flowCache.note(data: { me; profile; docRows; payoutSent })` and `nextStepHeld(): NextStep | null | 'unknown'` in `flow-cache.ts` (same rules as `nextStep` in `lib/next-step.ts`; `'unknown'` when nothing is held); `runDone` returns instantly: `{ type: 'missing', fields }`, `{ type: 'next', step }`, `{ type: 'end', role }`, `{ type: 'edit' }` (a finished screen: go back) or `{ type: 'myBusiness' }` (held data missing, or a refused entry pending: `goReplace('/my-profile')`), with `commit` replaced by `flush: () => void` (sends unsaved fields, never awaited); `loadNextStep()` also calls `flowCache.note(...)`; after each Done a background `loadNextStep()` refreshes the cache.

- [ ] **Step 1: Write failing tests:** `runDone` resolves without awaiting a pending `flush` (a promise that never resolves does not block it); missing fields give `{ type: 'missing' }` before anything is sent; with held data and a next step open the outcome is `next` with no network call; with `nextStepHeld()` returning `'unknown'` the outcome is `{ type: 'myBusiness' }`; with a refused entry pending the outcome is also `{ type: 'myBusiness' }`; `useDone` shows no "Saved" (the `saved` flag and `account.saved` use are removed) and has no pause.
- [ ] **Step 2: Run** `pnpm --filter mobile exec jest done-flow flow-cache` (Expected: FAIL).
- [ ] **Step 3: Implement** the cache, the instant `runDone`, and `useDone` without `saved`, `PAUSE_MS` or the focus-time snapshot (the `wasOpen` snapshot becomes `nextStepHeld()` read at focus, no request). `DoneBar` loses the `saved` prop and text. The screens pass `flush` (the savers' `flushNow` for About and Service, the silent `save(true)` for Account).
- [ ] **Step 4: Run** the affected specs, the three screens' specs and `tsc`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: the Done button is instant`.

### Task 8: Sign-out, texts, checks, README

**Files:**
- Modify: `apps/mobile/src/hooks/use-session.ts` (and its test), `apps/mobile/src/screens/account-screen.tsx` (the log-out button), `packages/i18n/src/en.ts`, `de.ts`, `README.md`

**Interfaces:**
- Consumes: Tasks 1 to 7. Produces: `signOut` asks first when the account has entries (`pending.signOutAsk`: "Some changes are not saved yet. Sign out anyway?" with the buttons "Sign out" and "Stay"); on confirm `dropAccount(accountId)` runs before the session ends; a 401 during a retry keeps the entry (state `'auth'`).

- [ ] **Step 1: Write failing tests** in `use-session.test.ts`: `signOut` with entries asks and does nothing on "Stay"; on confirm the account's entries are gone and the other accounts' stay.
- [ ] **Step 2: Run** `pnpm --filter mobile exec jest use-session` (Expected: FAIL).
- [ ] **Step 3: Implement** the question and the drop; add the texts in both languages.
- [ ] **Step 4: Full checks, once:** `pnpm --filter mobile exec jest`, `pnpm --filter @kando/i18n test`, `pnpm --filter @kando/contract test`, `pnpm typecheck`, `pnpm lint` (Expected: all pass). Then a manual check in the browser preview and on a phone: no signal while leaving a screen (the change is there after the signal returns); close the app with a pending change; an invalid postcode (banner, tap, field error); a new service created without signal; sign-out with a pending change.
- [ ] **Step 5: README** ("RESUME HERE": what changed, what to test), then commit `docs: README, instant Done and saves that are never lost`. Push only when the owner says so.

## Self-review

- Spec coverage: instant Done and no "Saved" (Task 7); a change is never dropped, persisted, retried after leaving and after restart (Tasks 1 to 3, 5); the category choice queued (Task 4); the banner with reasons and the tap to the field (Task 6, with the field error read from the stored entry); sign-out warning and 401 (Tasks 2 and 8); texts in both languages (Tasks 6 and 8).
- Open facts to confirm while building: the exact `expo-file-system` `File.write`/`text()` calls in SDK 58 (as used in `use-session.ts` for reads); the route of the service edit screen for the banner; that `servicesApi.update` accepts the same partial body the Service screen already sends.
