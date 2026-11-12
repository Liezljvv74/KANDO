# Instant Done button and saves that are never lost: design

Date: 12 November 2026. Decisions by the owner in the conversation of that day; marked "builder's call" where the owner did not decide.

## Intent and why

The profile screens (Account details, About you, Service) save every field by themselves, as they did before the Done button existed. The Done button is only there so the person **feels** they finished and is led on. Today it is slow, because it waits for every field to be confirmed by the server, asks the server up to five questions to find the next step, and pauses about a second. It also caused most of the findings of the review of the Done pull request (#134): busy states that never end, failed lookups, and so on.

The owner wants the person to be **confident that nothing is lost**, and Done to feel **instant**: the next screen opens at once, or a message about what is required appears at once.

## What it must do

1. **Done is instant.** Pressing Done never waits for the server.
   - If a required field is missing, the existing "Almost there! Please fill in: ..." message appears at once (the check is local and already instant).
   - Otherwise the next step opens at once. The next step is worked out from data the phone already holds (the shared `/me`, and the profile, services and documents the screens have loaded), not from five new requests. Where the phone does not yet hold the data, it opens My business (the checklist) rather than waiting.
   - The text "Saved" is not shown at all. The one-second pause is gone. The end-of-flow messages stay (`finishFlow`, including the payout-not-ready message).
2. **Done sends unsaved fields in the background**, the same way leaving the screen does today. It does not wait for the answer.
3. **A change is never dropped.** Every autosaved field of these three screens goes through one shared "pending saves" store:
   - A change that is not yet confirmed by the server is kept **on the phone** (persisted, so it survives closing the app, a crash or an empty battery).
   - It is retried in the background, **also after the person left the screen**: a few quick retries in the first minute (builder's call: after 2, 5, 15 and 45 seconds), then whenever the phone gets a connection back or the app returns to the front, and once when the app starts.
   - It is removed from the store only when the server accepted it. A newer change to the same field replaces the older one (the last change wins; builder's call).
   - A pending change belongs to one account: it is dropped at sign-out and never sent as another account.
4. **A banner at the top of every screen** tells the person while something is not saved yet, and why:
   - **Will be retried (no signal, the server is busy, a timeout, a 5xx):** "Your changes are not saved yet: no connection. We keep them and try again." No action needed. It goes away by itself once everything is saved.
   - **The server refuses the value itself (a 4xx such as an invalid postcode, a name refused as contact details):** retrying can never work, so the app stops retrying that field. The banner names the problem ("The postcode you entered is not valid") and **tapping it opens the screen with that field**, which shows the error text beside the field (the same texts the screens already show). The refused value stays on the phone and in the field until the person corrects it.
   - The banner is shown on every screen, signed in, and is not dismissible while something is unsaved (it is not a toast that disappears).
5. **Nothing changes** in how fields save while the person is on the screen: the 600 ms autosave, save on blur, the "saving / error / Retry" state beside a field, and the saves when the app goes to the background.
6. Texts in German and English (`packages/i18n`). The banner texts and the reason texts exist for: no connection, server busy, and "the server refused this value" (field name plus the existing field error text).

## Goals, non-goals, anti-goals

- Goals: Done feels instant; no entered information is ever silently lost; the person always knows if something is not saved and why.
- Non-goals: documents and photo uploads (they have their own flow and are not field saves); the Jobs, chat and booking screens; offline use of the whole app; merging edits made on two devices (last change wins).
- Anti-goals: a banner that disappears while data is unsaved; the app saying "saved" when it is not (it says nothing instead); retrying a refused value for ever; one account's pending change being sent as another account.

## Constraints

- Applies to: Account details (`screens/account-screen.tsx`, `lib/account-autosave.ts`), About you (`screens/my-profile/about-screen.tsx`), Service (`screens/my-profile/service-screen.tsx`), through `hooks/use-field-save.ts` (`createFieldSaver`) and the Done flow (`hooks/use-done.ts`, `lib/done-flow.ts`, `lib/flow-state.ts`, `lib/next-step.ts`).
- Storage on the phone: `expo-secure-store` is what the app uses today (small values); a larger or structured queue may need another store (builder's call; nothing secret is kept, only field values the person typed).
- No new server endpoint is needed. Writes use the existing endpoints; a retry sends the same request. A refused value is told apart from a retryable failure by the response status the app already reads (`ApiError`: 4xx other than 408 and 429 is "refused"; network, 408, 429 and 5xx are "retry").
- Every user-facing text in German and English. No spinner anywhere (owner rule). Rules in `CLAUDE.md` apply (tests per task, the full suites once at the end, one branch and one PR).
- Branch: `feat/done-button` (this changes how Done works; pull request #134 is open and not merged).

## Decisions made after the first read-through

By the owner:
- **The category choice of a new service is queued too.** Choosing a category creates the service on the server. If that fails (no signal), the choice is kept on the phone and retried later, and every field typed after it is kept behind it (the service is created first, then the fields are saved against the real id). The service shows on the screen under a local temporary id until then.

Builder's calls (marked here so the owner can check them):
- **Queue unit:** per field with a partial body for About you and Service; Account details is one whole-form entry (names, address and birth date are validated together by the server). Last change wins per entry.
- **Next step after an instant Done:** the screen just left is trusted (its required fields passed the local check). Other steps use data the phone already holds. If that data is not held, Done opens My business (a pending refused value does not change this, see below) (the checklist stays the authority).
- **Sign-out with unsaved changes:** the app asks first ("Some changes are not saved yet. Sign out anyway?"); if confirmed, the pending changes of that account are dropped. A different account never receives them.
- **Expired login (401):** the entry is kept and resumes after the same person signs in again (matched by account id). 403 and 428 (terms must be accepted again) wait for the person; a 404 (the service no longer exists) counts as refused with a clear text.
- **Several refused values:** the banner shows how many need attention and a tap opens the first (oldest). The refused banner survives an app restart and the field shows its error text when the screen opens (the error comes from the stored entry, not from screen state).
- **Done with a refused value pending:** Done still opens the next step at once; the banner stays. Publishing is still checked by the server.
- **Storage:** the queue is persisted in a file-based store (long texts such as the bio do not fit secure-store); nothing secret is kept.

## What the builder decides

The queue's storage format and keys; the exact retry timing (the numbers above are a starting point); how the banner is mounted once for every screen (it must sit above all screens, in the root layout); the wording of the German texts (checked by the author, the owner does not review German); how the local "next step" is computed from held data (the rules in `lib/next-step.ts` stay the same).

## Tests

Unit tests for the pending-saves store (kept across a restart, last change wins, dropped at sign-out, refused versus retryable, retry timing with fake timers), for `runDone` (instant outcomes: missing, next, end), and for the banner's state. A manual check in the browser preview and on a phone: no signal while leaving a screen, closing the app with a pending change, an invalid postcode.
