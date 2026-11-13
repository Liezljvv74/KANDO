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

## Architect review changes (12 November; binding on every task)

1. **No double create:** before the runner resends a `'service-create'`, it lists the services (`servicesApi.list`) and takes over one with that category that the phone does not know yet (replace `tmp:<n>` with its id); only then does it POST. Test in Task 4.
2. **One sender per key:** the screen saver sends through `sendNow(key)` (never calls the API directly) when it has a `queue`, so the saver and the runner never have two requests out for one key.
3. **Kept when typed:** the entry is `putEntry`'d when the value is set (before the 600 ms wait), not when it is sent. The file write is already coalesced.
4. **Load merges:** `loadStore()` merges the file into the in-memory map (an entry put before loading finished wins by version) and never replaces it. Test: put, then load.
5. **Screens read the store:** a reopened About you, Service or Account screen fills a field from its pending or refused entry first (the server value only when there is none) and shows the stored error text for a refused one. `usePendingEntry(key)` in Task 1 for this; used in Tasks 3, 4 and 5.
6. **No silent drop:** `service-screen.tsx` `if (!body || !idRef.current) return` must not count as a success for a queued field: a value typed before the service exists is put under the temporary id and sent after the create. `toBody` returning `null` removes the key's entry.
7. **Done skips the finished screen:** `nextStepHeld(justFinished)` ignores the step of the screen just left (its fields passed the local check) and returns the next open step.
8. **Keep the request on screen open:** the request when a Done screen opens stays (never awaited); it fills the flow cache, so the first Done has data.
9. **Refused value and Done (design lines 51 and 55 disagreed):** the design is changed to match line 55: Done with a refused entry pending still opens the next step; the banner stays. Only held data that is missing opens My business.
10. **Code facts:** About you reads `?field=` (not `?focus=`); the autoFocus check there uses `basePostcode` (the save key), not `'postcode'`; a banner route never carries a temporary service id (a temporary id opens the new-service screen for that entry's category instead).
11. **Account scope:** `bannerState` and `usePendingEntries` list only the signed-in account's entries (`usePendingEntries(accountId)`); the runner also wakes when the session changes (sign-in), not only at start and foreground; deleting the account (`account-data-section.tsx`) calls `dropAccount` (covers "delete my data").
12. **Should-fix, all in:** the file is written to a temporary file and moved over the real one (atomic); a request that never answers does not stall other keys (the runner never awaits one key before trying the next; runner writes get a 30 s time limit, creates only after change 1); `markFailed(key, version, e, field?)` can set the `field`; the entry keeps `status` (HTTP status) so the banner tells "no connection" (0) from "busy"; `'waiting'` entries are retried on foreground and after the terms are accepted; a 404 on a service drops that service's entries and shows a short notice (`pending.serviceGone`); a `toBody` null removes the entry.
13. **Notes for the DPIA, not built:** the queue holds personal data (street, birth date) in the documents folder; a queued change older than seven days is dropped when the app starts (two-device overwrite risk).

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
  - `loadStore(): Promise<void>` (reads the file once at start and MERGES it into memory; a missing, unreadable or invalid file gives an empty store; entries older than 7 days are dropped), `subscribe(fn: () => void): () => void`, `usePendingEntries(accountId: string | null): PendingEntry[]`, `usePendingEntry(key: string): PendingEntry | undefined`, `removeKey(key: string): void`, `replaceServiceRef(from: string, to: string): void`
  - `PendingEntry` also has `status?: number` (HTTP status of the last failure) and `createdAt: number`; `markFailed(key, version, e, field?)`
  - Writes are atomic (temporary file, then move over `pending-saves.json`).

- [ ] **Step 1: Write the failing tests** in `pending-saves.test.ts` (the file layer mocked with an in-memory string): `putEntry` twice with the same key keeps one entry and the second version is higher; `clearIfVersion` with an old version does nothing, with the newest removes it; `classifyFailure` returns `'refused'` for `new ApiError(400, 'Invalid postcode')` and `new ApiError(404, 'Not found')`, `'auth'` for 401, `'waiting'` for 403 and 428, `'retry'` for status 0, 408, 429 and 503; `markFailed` sets state and reason and increments attempts; `dropAccount('a')` leaves the entries of `'b'`; after `loadStore()` from a written file the entries are back (a restart); `loadStore()` with the text `'{not json'` gives an empty list and does not throw; an entry put BEFORE `loadStore()` finishes survives the load (merge); an entry older than 7 days is dropped on load; `usePendingEntries('a')` lists only account a; the write goes to a temporary file first (assert the mocked move call).
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
  - `startRunner(getAccountId: () => string | null): () => void` (loads the store, retries entries of the signed-in account on the schedule, on `AppState` 'active', at start, and when the session changes (the root layout calls `wake()` when `user` changes); returns the stop function). `wake(): void`. Entries run per `serviceRef` in order, different refs in parallel; a hanging request (30 s limit) never blocks other refs. `'waiting'` entries are retried on 'active' and on `wake()`.

- [ ] **Step 1: Write failing tests** with jest fake timers and a fake sender: a retryable failure is tried again after 2 s, then 5 s, 15 s, 45 s, then every 60 s; a refused failure stops retrying (state `'refused'`) and is not tried again until the entry is replaced; an `'auth'` entry waits and is sent once `getAccountId()` returns the same account; an entry of another account is never sent; two entries of one `serviceRef` are sent in the order they were put; a success clears the entry only if the version is still the newest (a newer value put during the send is sent next); two calls of `sendNow` for one key never overlap; a sign-in (`wake()`) sends an `'auth'` entry at once; a never-resolving send for one service does not stop another service's entry; a 404 on a service entry drops that service's entries.
- [ ] **Step 2: Run** `pnpm --filter mobile exec jest pending-runner` (Expected: FAIL).
- [ ] **Step 3: Implement** `registerSender`, `sendNow` and `startRunner` as above; an entry whose kind has no registered sender is left alone.
- [ ] **Step 4: Run** the spec and `tsc`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: background retries for pending saves`.

### Task 3: Field saves go through the store (About you, Service)

**Files:**
- Modify: `apps/mobile/src/hooks/use-field-save.ts`, `apps/mobile/src/screens/my-profile/about-screen.tsx`, `apps/mobile/src/screens/my-profile/service-screen.tsx`, `apps/mobile/src/hooks/use-field-save.test.ts`

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: `useFieldSave(initial, save, delayMs?, queue?)` where `queue?: { key: string; kind: SaveKind; accountId: string; route: string; field: string; serviceRef?: string; toBody: (v: V) => object | null }`. With `queue`, setting a value `putEntry`s it at once (the persisted copy, before the debounce; `toBody` null calls `removeKey`), the send goes through `sendNow(key)` (never the API directly), a success clears via `clearIfVersion`, a failure `markFailed`s and still reports `'error'` as today; the screens fill initial values from `usePendingEntry(key)` (see change 5). `dispose()` and `flushNow()` keep sending as today and now leave a persisted entry behind when the send did not finish.

- [ ] **Step 1: Write failing tests** in `use-field-save.test.ts` (on `createFieldSaver`): a failed save leaves the entry in the store with state `'retry'`; a later success of a newer value clears it; after `dispose()` with a failing save the entry is still in the store; a refused failure (400) marks the entry `'refused'` with the error code as `reason`; a value set and the app "killed" before the 600 ms wait is still in the store; the saver never calls `save` directly (only `sendNow`), so two senders for one key cannot overlap.
- [ ] **Step 2: Run** `pnpm --filter mobile exec jest use-field-save` (Expected: FAIL).
- [ ] **Step 3: Implement** the `queue` option in `createFieldSaver` (no behaviour change when it is absent); pass it from the `useField` helpers in `about-screen.tsx` (kind `'about'`, key `about:<field>`, route `/my-profile/about?field=<field>`; the postcode field's save key is `basePostcode`, fix its `autoFocus` check) and `service-screen.tsx` (kind `'service-field'`, key `service:<serviceRef>:<field>`, route the service's edit screen). Register senders (`saveMyProfile(body)` for `'about'`; `servicesApi.update(serviceRef, body)` for `'service-field'`) once at app start in `_layout.tsx`.
- [ ] **Step 4: Run** the spec, the screens' existing specs and `tsc`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: About you and Service fields are kept and retried when a save fails`.

### Task 4: The category choice of a new service is queued

**Files:**
- Modify: `apps/mobile/src/lib/serial-create.ts`, `apps/mobile/src/lib/serial-create.test.ts`, `apps/mobile/src/screens/my-profile/service-screen.tsx`, `apps/mobile/src/lib/pending-runner.ts`

**Interfaces:**
- Consumes: Tasks 1 to 3.
- Produces: kind `'service-create'` (body `{ categoryId }`, `serviceRef` a temporary id `tmp:<n>`); in the runner, when a `'service-create'` entry succeeds the real id replaces `tmp:<n>` in every pending entry that carries that `serviceRef` (their keys too), and listeners are notified so an open Service screen can swap its id.

- [ ] **Step 1: Write failing tests:** before resending a create the runner lists services and takes over an existing one of that category the phone does not know (no second POST); a field typed before the service exists is put under the temporary id and sent after the create; the runner sends the create first, then the dependent field entries with the real id (never with `tmp:`); a failed create keeps the dependents waiting and unsent; two category changes before the create succeeds leave one create entry with the newest category; `dropService(tmpOrId)` removes the service's entries.
- [ ] **Step 2: Run** `pnpm --filter mobile exec jest serial-create pending-runner` (Expected: FAIL).
- [ ] **Step 3: Implement** the entry type in the runner and the id replacement in the store (`replaceServiceRef(from: string, to: string): void`); in `service-screen.tsx` `chooseCategory` puts a `'service-create'` entry when the create fails (it keeps the temporary id and shows the service as chosen); the screen swaps to the real id when told.
- [ ] **Step 4: Run** the specs and `tsc`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: the category choice of a new service is kept and retried`.

### Task 5: Account details as one queued entry

**Files:**
- Modify: `apps/mobile/src/screens/account-screen.tsx`, `apps/mobile/src/lib/account-autosave.ts`, `apps/mobile/src/lib/account-autosave.test.ts`

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Also: the account screen fills from `usePendingEntry('account')`, shows a refused entry's error, and `account-data-section.tsx` (delete my data) calls `dropAccount`; `markFailed` is given the `field` from `refusedField`.
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
- Note: the banner's refused tap goes to `first.route`; for an entry that still has a temporary service id the route is the new-service screen for its category, never `/my-profile/service/tmp:...`. Add `pending.serviceGone` (German and English) for a deleted service.
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
- Produces: `flowCache.note(data: { me; profile; docRows; payoutSent })` and `nextStepHeld(justFinished: Step): NextStep | null | 'unknown'` in `flow-cache.ts` (same rules as `nextStep` in `lib/next-step.ts` but ignoring the `justFinished` step; `'unknown'` when nothing is held); `runDone` returns instantly: `{ type: 'missing', fields }`, `{ type: 'next', step }`, `{ type: 'end', role }`, `{ type: 'edit' }` (a finished screen: go back) or `{ type: 'myBusiness' }` (held data missing only: `goReplace('/my-profile')`; a pending refused entry does NOT change the outcome), with `commit` replaced by `flush: () => void` (sends unsaved fields, never awaited); `loadNextStep()` also calls `flowCache.note(...)`; after each Done a background `loadNextStep()` refreshes the cache.

- [ ] **Step 1: Write failing tests:** `runDone` resolves without awaiting a pending `flush` (a promise that never resolves does not block it); missing fields give `{ type: 'missing' }` before anything is sent; with held data and a next step open the outcome is `next` with no network call; with `nextStepHeld()` returning `'unknown'` the outcome is `{ type: 'myBusiness' }`; with a refused entry pending the outcome is still `next`; after finishing About you the held "next step" is never About you itself; `useDone` shows no "Saved" (the `saved` flag and `account.saved` use are removed) and has no pause.
- [ ] **Step 2: Run** `pnpm --filter mobile exec jest done-flow flow-cache` (Expected: FAIL).
- [ ] **Step 3: Implement** the cache, the instant `runDone`, and `useDone` without `saved`, `PAUSE_MS` or the focus-time snapshot (the request when the screen opens STAYS, never awaited, and fills the flow cache; the `wasOpen` snapshot is read from the cache). `DoneBar` loses the `saved` prop and text. The screens pass `flush` (the savers' `flushNow` for About and Service, the silent `save(true)` for Account).
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
