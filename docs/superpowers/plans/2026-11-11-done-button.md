# "Done" button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On every screen a person must complete, a fixed "Done" button saves, shows "Saved", and moves the person to the next open required step, ending with a clear "everything is done" (customer: Search; provider: change-or-add question, then the Publish switch).

**Architecture:** Pure, tested functions decide everything (`nextStep` from the server's lists, `runDone` for the Done outcome, `required-fields` for the friendly "what is missing" text). A thin hook and one shared bottom bar wire them into the three Done screens (Account details, About you, Service). Documents and payouts have no button: finishing them calls the same "next step" function.

**Tech Stack:** Expo SDK 58, expo-router, React Native, `react-native-keyboard-controller` 1.22.7, TypeScript, Jest (`jest-expo`) in `apps/mobile`; texts in `packages/i18n` (en.ts, de.ts).

**Spec:** `docs/superpowers/specs/2026-11-11-done-button-design.md` (approved by the owner 11 November 2026). Read it first; this plan only adds file names, signatures and tests.

## Global Constraints

- Every user-facing text in German and English (`packages/i18n/src/de.ts` and `en.ts`; German is the main language). The button already has `common.done` ("Done" / "Fertig"); "Saved" already has `account.saved`.
- Done is **fixed at the bottom** of the screen, above the on-screen keyboard (use `KeyboardStickyView` from `react-native-keyboard-controller`).
- "Saved" is shown only after the server accepted every save; a failure shows the error and never "Saved".
- Done appears only on: Account details, About you, Service (new and edit). Not on documents, payouts, references, portfolio, photo, or the My business page.
- Done replaces the Save button on Account details.
- "Saved" uses the existing look (`useFlash`, 3000 ms default, `account.saved`). After "Saved" the move to the next screen waits about 1000 ms.
- Provider order of required steps: account details, About you, Service, required documents (never uploaded or rejected), payouts. A document under check is not open.
- First press with something open = flow (next step / end of flow). A press when nothing was open before = edit: "Saved" and back (`goBack`), never Search or the Publish prompt.
- Per `CLAUDE.md`: one branch (`feat/done-button`) and one PR; the owner merges; no AI co-author lines; per task run only the affected tests and `tsc`; full mobile suite once at the end; update `README.md`; no database change.
- **Leave anytime (owner, 11 Nov):** the person can stop, press back, or close the app at any point and what was entered stays saved so they can continue later (the My business checklist shows what is still open). Done is never required to keep data; it only gives confirmation and guidance. See Task 12.
- Run mobile tests with `pnpm --filter mobile test -- <path>`; typecheck with `pnpm --filter mobile typecheck`.

## Review Focus

1. **Double tap on Done** (or Done during a running save): one save, one navigation. Pinned in Task 4.
2. **One of several fields fails to save** (network or server error): no "Saved", the person stays, the field's own error shows. Pinned in Tasks 1 and 4.
3. **The save worked but the "what is next" request fails**: show "Saved" and go back (edit outcome); never a blank screen or a loop. Pinned in Task 4.
4. **Provider already complete, changing one value later**: "Saved" and back; no end-of-flow prompt. Pinned in Task 4.
5. **Document statuses**: `pending` and `approved` are not open; `rejected` and never uploaded (`none`, not optional) are open. Pinned in Task 2.
6. **Tags typed but not yet added** (About: skills, strengths) must be saved by Done. Pinned in Task 8.
7. **A customer who also offers services** (provider flag on): the provider order applies. Pinned in Task 2.

## File Structure

- Modify `apps/mobile/src/hooks/use-field-save.ts`: `commit()` (resend a failed value, resolve success).
- Create `apps/mobile/src/lib/next-step.ts` (+ test): which step is next.
- Create `apps/mobile/src/lib/required-fields.ts` (+ test): what is empty, and the friendly text.
- Create `apps/mobile/src/lib/done-flow.ts` (+ test): `runDone`, the outcome decision.
- Create `apps/mobile/src/lib/flow-state.ts` (+ test): `loadNextStep()` and `goToStep()`.
- Create `apps/mobile/src/components/done-bar.tsx`; modify `components/form-ui.tsx` (`FormScreen` gets `footer`).
- Create `apps/mobile/src/hooks/use-done.ts`: React wiring (busy, Saved flash, message, navigation).
- Modify `screens/my-profile/about-screen.tsx`, `service-screen.tsx`, `screens/account-screen.tsx`, `screens/my-profile/document-screen.tsx`, `screens/setup/setup-screen.tsx`, `screens/setup/publish-bar.tsx`.
- Modify `packages/i18n/src/en.ts`, `de.ts`; `README.md`.

---

### Task 1: `commit()` on the field saver

**Files:** Modify `apps/mobile/src/hooks/use-field-save.ts`; Test `apps/mobile/src/hooks/use-field-save.test.ts`.

**Interfaces:** Produces `createFieldSaver(...).commit(): Promise<boolean>` and `useFieldSave(...).commit: () => Promise<boolean>`: resends the newest value when the last save failed, waits for everything in flight, resolves `true` only when the last save succeeded (or nothing was ever dirty). `flush` is unchanged.

- [ ] **Step 1: Failing tests** (reuse the file's existing fake-save helpers): `commit resolves true after a successful save`, `commit resolves false when the save rejects`, `commit resends a value whose last save failed and resolves true when the resend works`, `commit resolves true when nothing was typed`, `flush still resolves without a value (unchanged)`.
- [ ] **Step 2:** Run `pnpm --filter mobile test -- src/hooks/use-field-save.test.ts`; expect FAIL (`commit is not a function`).
- [ ] **Step 3:** Implement. Track `lastOk` (set `true` after a successful `save`, `false` in the catch); `commit` sets `dirty = true` when `!lastOk`, calls `flush()`, then returns `lastOk`.
- [ ] **Step 4:** Run the same command; expect PASS.
- [ ] **Step 5:** Commit `feat: field saver commit() reports whether the save worked`.

### Task 2: Which step is next

**Files:** Create `apps/mobile/src/lib/next-step.ts`; Test `apps/mobile/src/lib/next-step.test.ts`.

**Interfaces:**
- Produces `type NextStep = { kind: 'account' | 'about' | 'service' | 'document'; path: string } | { kind: 'payout' }`.
- Produces `openSteps(i: { isProvider: boolean; accountComplete: boolean; profile: Pick<MyProfile, 'missing' | 'quoteSteps'> | null; docRows: DocumentRow[] }): NextStep[]` and `nextStep(i): NextStep | null` (the first).
- Consumes `checklistItems`/`openItems` (`lib/live-checklist.ts`), `DocumentRow` (`lib/documents.ts`), `MyProfile`.

- [ ] **Step 1: Failing tests** with exact values: customer with `accountComplete: false` → `[{ kind: 'account', path: '/account' }]`; customer complete → `[]`; provider order for `missing: ['service', 'skills']`, a never-uploaded required doc `{ requirement: 'photo-id', optional: false, state: 'none', note: null }` and `quoteSteps: ['payout']` → account (if incomplete), then `about` (`/my-profile/about?field=skills`), `service` (`/my-profile/service/new`), `document` (`/my-profile/document/photo-id`), then `{ kind: 'payout' }`; `pending` and `approved` documents are not listed, `rejected` is; an optional `none` document is not listed; `quoteSteps: ['consent', 'taxId']` are not listed (owner named only payouts); `profile: null` for a provider gives `[]`.
- [ ] **Step 2:** Run `pnpm --filter mobile test -- src/lib/next-step.test.ts`; expect FAIL (module missing).
- [ ] **Step 3: Implement** as above. About items come from `openItems(checklistItems(...))` filtered to paths starting `/my-profile/about`; the `name` item is the account (covered by `accountComplete`).
- [ ] **Step 4:** Run; expect PASS. **Step 5:** Commit `feat: next required step from the profile, documents and payout state`.

### Task 3: What is empty, and the friendly message

**Files:** Create `apps/mobile/src/lib/required-fields.ts`; Test `apps/mobile/src/lib/required-fields.test.ts`.

**Interfaces:** Produces `accountMissing(v: { firstName: string; lastName: string; postcode: string; hasBirthDate: boolean; isProvider: boolean }): Key[]`, `aboutMissing(v: { providerType: string | null; businessName: string; impressum: string; strengths: string[]; skills: string[]; postcode: string; radiusValid: boolean }): Key[]`, `serviceMissing(v: { category: string | null; priceType: string | null; price: string }): Key[]`, `missingMessage(keys: Key[]): string` (uses `flow.missing` with `{fields}` = the translated labels joined by ", "). The keys are the label keys the screens already show (`COMPULSORY[...].label`, the account form's own labels).

- [ ] **Step 1: Failing tests:** `aboutMissing` for an individual does not ask for business name or legal notice; for `providerType: 'business'` it does; `serviceMissing` with `priceType: 'on-request'` and empty price returns `[]` (server rule, `packages/domain/src/providers/profile.ts`: price needed unless on-request); with `priceType: 'fixed'` and empty price returns `['s.price']`; `accountMissing` asks for birth date only when `isProvider`; `missingMessage(['s.price'])` contains the English label "Price" (set language `en` in the test).
- [ ] **Step 2:** Run `pnpm --filter mobile test -- src/lib/required-fields.test.ts`; FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit `feat: required-field checks and the friendly missing text`.

### Task 4: The Done decision (`runDone`)

**Files:** Create `apps/mobile/src/lib/done-flow.ts`; Test `apps/mobile/src/lib/done-flow.test.ts`.

**Interfaces:**
- Produces `type DoneOutcome = { type: 'missing'; fields: Key[] } | { type: 'failed' } | { type: 'edit' } | { type: 'next'; step: NextStep } | { type: 'end'; role: 'customer' | 'provider' }`.
- Produces `runDone(d: { isProvider: boolean; missing: () => Key[]; commit: () => Promise<boolean>; loadNext: () => Promise<NextStep | null> }): Promise<DoneOutcome>`.
- Produces `createOnce(fn)`: returns a function that ignores calls while the previous call has not finished (double-tap guard).

- [ ] **Step 1: Failing tests:** missing fields → `{ type: 'missing', fields }` and `commit` not called; `commit` false → `{ type: 'failed' }`; nothing open before, still nothing after → `{ type: 'edit' }`; something open before and a next step after → `{ type: 'next', step }`; something open before and nothing after → `{ type: 'end', role: 'provider' }` (and `'customer'` when `isProvider` is false); `loadNext` throws after a good commit → `{ type: 'edit' }`; `loadNext` throws before the save → treated as flow (runs on); `createOnce` called twice at once runs the function once.
- [ ] **Step 2:** Run `pnpm --filter mobile test -- src/lib/done-flow.test.ts`; FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit `feat: the Done outcome decision`.

### Task 5: Texts (German and English)

**Files:** Modify `packages/i18n/src/en.ts`, `packages/i18n/src/de.ts`.

**Interfaces:** Produces keys `flow.missing` ("Almost there! Please fill in: {fields}" / "Fast geschafft! Bitte noch ausfüllen: {fields}"), `flow.allDone` ("Everything is done" / "Alles erledigt"), `flow.customerDone` ("Everything is done. You can now look for help." / "Alles erledigt. Du kannst jetzt Hilfe suchen."), `flow.question` ("Do you want to change or add something?" / "Möchtest du etwas ändern oder ergänzen?"), `flow.yesChange` ("Yes, change or add" / "Ja, ändern oder ergänzen"), `flow.noContinue` ("No, continue" / "Nein, weiter"), `flow.toPublish` ("You will now be taken to publish your profile." / "Du wirst jetzt zum Veröffentlichen deines Profils weitergeleitet."). Also change `setup.liveMessage` to include the reminder: "Your profile is live. Share it now so customers can find you." / German equivalent.

- [ ] **Step 1:** Add the keys to both files (the i18n tests fail if a key exists in one language only). **Step 2:** Run `pnpm --filter @kando/i18n test` (or the package's test script) and `pnpm --filter mobile typecheck`; expect PASS. **Step 3:** Commit `feat: texts for the Done flow (German and English)`.

### Task 6: The end of the flow (`finishFlow`)

**Files:** Create `apps/mobile/src/lib/finish-flow.ts`; Test `apps/mobile/src/lib/finish-flow.test.ts`.

**Interfaces:** Produces `finishFlow(role: 'customer' | 'provider'): void`: customer shows `Alert.alert(t('flow.allDone'), t('flow.customerDone'))` and goes to Search with `goReplace('/search')`; provider shows `Alert.alert(t('flow.allDone'), t('flow.question'), [{ text: t('flow.yesChange'), onPress: () => goReplace('/my-profile') }, { text: t('flow.noContinue'), onPress: () => { Alert.alert(t('flow.toPublish')); goReplace('/my-profile', { publish: '1' }) } }])`. Consumes `goReplace` (`lib/go.ts`), the Task 5 texts.

- [ ] **Step 1: Failing tests** (mock `react-native` `Alert` and `lib/go`): `customer: goes to /search`, `provider yes: goes to /my-profile`, `provider no: goes to /my-profile with { publish: '1' }`.
- [ ] **Step 2:** Run `pnpm --filter mobile test -- src/lib/finish-flow.test.ts`; expect FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit `feat: the end-of-flow messages and routes`.

### Task 7: Loading the state, the screen wiring

**Files:** Create `apps/mobile/src/lib/flow-state.ts` (+ `flow-state.test.ts`), `components/done-bar.tsx`, `hooks/use-done.ts`; Modify `components/form-ui.tsx`.

**Interfaces:**
- Produces `loadNextStep(): Promise<NextStep | null>`: loads fresh `loadMe()`, and for a provider `getMyProfile()`, `servicesApi.list()`, `documentsApi.list()` and the categories (the same source `useCategories` reads), then returns `nextStep(...)`; `accountComplete` as `account-screen.tsx` computes it.
- Produces `goToStep(step: NextStep): Promise<void>`: routes with `goReplace(step.path)` (so back does not return to the finished screen); for `{ kind: 'payout' }` calls `openPayoutSetup()` and, when its status is ready, `loadNextStep()` and goes on, otherwise `goReplace('/my-profile')`.
- Produces `DoneBar({ onPress, busy, saved, message }: ...)`: the fixed bar (inside `KeyboardStickyView`) with the `common.done` button, the "Saved" text (`account.saved`) and the message line; `FormScreen` gets `footer?: ReactNode` rendered under the scroll area.
- Produces `useDone(cfg: { isProvider: boolean; missing: () => Key[]; commit: () => Promise<boolean> }): { onDone: () => void; busy: boolean; saved: boolean; message: string | null }`: wraps `runDone` in `createOnce`, shows "Saved" with `useFlash`, waits 1000 ms, then acts on the outcome (`edit` → `goBack`, `next` → `goToStep`, `end` → Task 6 `finishFlow(role)`).

- [ ] **Step 1: Failing test** for `loadNextStep`: with mocked APIs (provider, `missing: ['service']`, no documents, `quoteSteps: ['payout']`) it returns `{ kind: 'service', path: '/my-profile/service/new' }`; with everything done it returns `null`; with a customer whose account is complete it returns `null` without calling the provider APIs.
- [ ] **Step 2:** Run `pnpm --filter mobile test -- src/lib/flow-state.test.ts`; FAIL. **Step 3:** Implement `flow-state.ts`, then `DoneBar`, `FormScreen.footer`, `useDone` (UI parts are checked by typecheck and the manual check in Task 11). **Step 4:** Run the test; PASS, and `pnpm --filter mobile typecheck`. **Step 5:** Commit `feat: Done bar, next-step loading and the useDone hook`.

### Task 8: Wire About you and Service

**Files:** Modify `screens/my-profile/about-screen.tsx`, `screens/my-profile/service-screen.tsx`.

**Interfaces:** Consumes `useDone`, `aboutMissing`, `serviceMissing`, `useFieldSave().commit`, `DoneBar`, `FormScreen footer`.

- [ ] **Step 1:** About: `commit` first runs the typed-tags flush already registered (`lib/pending-tags.ts`, so tags typed but not added are saved), then `Promise.all` of every field's `commit()`; `missing` calls `aboutMissing` with the current values; `isProvider: true`; the `DoneBar` goes in `FormScreen footer`. Remove nothing else (fields keep saving on blur).
- [ ] **Step 2:** Service: `commit` also awaits a running category create (`serial.creating()`), then commits `title`, `description`, `priceType`, `price`; `missing` calls `serviceMissing`; same footer.
- [ ] **Step 3:** `pnpm --filter mobile typecheck`; expect no errors. **Step 4:** Commit `feat: Done button on About you and Service`.

### Task 9: Account details and the Publish handover

**Files:** Modify `screens/account-screen.tsx`, `screens/setup/setup-screen.tsx`, `screens/setup/publish-bar.tsx`.

**Interfaces:** Consumes `useDone`, `accountMissing`, `DoneBar`, `FormScreen`-style footer on the Account screen's own `SafeAreaView`.

- [ ] **Step 1:** Account: replace the Save `Button` with `DoneBar` fixed at the bottom (inside `KeyboardStickyView`); `commit` is the existing `save()` body returning `true` on success and `false` on a validation or server error (the existing error texts stay); `missing` uses `accountMissing`; `isProvider` from `showProfileTab`. The existing inline "Saved" flash is replaced by the bar's.
- [ ] **Step 2:** My business: when `?publish=1` is present, scroll to the top and give the Publish switch (`PublishBar`) a short highlight; `publish-bar.tsx` already shows the live message with the Share button, now with the reminder text from Task 5.
- [ ] **Step 3:** `pnpm --filter mobile typecheck`; expect no errors. **Step 4:** Commit `feat: Done on Account details, publish handover`.

### Task 10: Documents and payouts move on by themselves

**Files:** Modify `screens/my-profile/document-screen.tsx`, `screens/setup/payout-card.tsx` (and the checklist row that calls `doQuoteStep('payout')`).

**Interfaces:** Consumes `loadNextStep`, `goToStep`, `finishFlow`; Produces `continueAfterAutoStep(): Promise<void>` in `lib/flow-state.ts` (loads the next step; a step → `goToStep`; none → `finishFlow(role)`; a load error → `goReplace('/my-profile')`).

- [ ] **Step 1: Failing test** for `continueAfterAutoStep` (mocked `loadNextStep`): next step present → routes; null → `finishFlow('provider')`; throws → `/my-profile`.
- [ ] **Step 2:** Run the test; FAIL. **Step 3:** Implement; call it after a successful document upload (the add flow in `document-screen.tsx`) only when this document was open before the upload, and after `openPayoutSetup()` returns a ready status. **Step 4:** Test PASS and `typecheck`. **Step 5:** Commit `feat: documents and payouts continue the flow by themselves`.

### Task 12: Nothing is lost when the person leaves

**Files:** Modify `hooks/use-field-save.ts` (+ its test), `screens/account-screen.tsx`, `screens/my-profile/about-screen.tsx`, `screens/my-profile/service-screen.tsx`; Test `src/hooks/use-field-save.test.ts`, `src/lib/pending-tags.test.ts` if it exists.

**Interfaces:** Consumes `createFieldSaver`, `AppState`. Produces: each `useFieldSave` also flushes immediately (no 600 ms wait) when the app goes to `background`/`inactive` (`AppState` listener in the hook) and on unmount (already via `dispose`); typed-but-not-added tags (`lib/pending-tags.ts`) are flushed on unmount and on background too; Account details saves the valid values when the screen is left or the app is backgrounded, quietly (no "Saved" flash, no error alert; an invalid value, e.g. a half-typed postcode, is simply not sent), using the same save call as Done.

- [ ] **Step 1: Failing tests:** `createFieldSaver` exposes `flushNow()` equal to `flush` semantics that a hook calls on background; `dispose with a dirty value sends it` (already true; keep the test); account silent-save helper (pure function in `lib/account-autosave.ts`: `shouldAutosave(values) -> boolean`, false for invalid postcode or empty required names, true otherwise) with those cases.
- [ ] **Step 2:** Run the tests; FAIL. **Step 3:** Implement the AppState listener in `useFieldSave`, the pending-tags flush on unmount/background, and the Account silent save (unmount + background) guarded by `shouldAutosave`. **Step 4:** Tests PASS; `pnpm --filter mobile typecheck`. **Step 5:** Commit `feat: nothing entered is lost when the person leaves a screen`.

### Task 11: Checks, docs, hand-over

- [ ] **Step 1:** `pnpm --filter mobile test` (whole mobile suite) and `pnpm --filter mobile typecheck` and `pnpm --filter @kando/i18n test`; expect all PASS.
- [ ] **Step 2:** Also check: type in a field, press back or close the app at once, reopen: the value is there, and My business still lists what is open. Manual check in the browser harness or on a phone (fresh provider account, then a fresh customer account): each Done shows "Saved", moves to the next step in the order above, the last step shows the question, "No" lands on the Publish switch; a complete screen's Done shows "Saved" and goes back; the bar stays above the keyboard. Record what was and was not checked.
- [ ] **Step 3:** Update `README.md` ("State of the product"; note that the Android app needs a new build) and commit `docs: README, the Done button`.
- [ ] **Step 4:** Open the pull request in both repositories only when the owner asks; run `/code-review --comment` before the merge.
