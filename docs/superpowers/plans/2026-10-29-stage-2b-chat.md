# Stage 2b: chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every request and booking has one chat thread with text and photos (including the photos of a request), messages are immutable, contact details are blocked by rules at every stage, either side can report a message or block the other, staff can read a thread only when there is a reason, and quote, acceptance and additional-task cards appear inside the thread.

**Architecture:** Two append-only tables (`threads`, `messages`) plus `blocks`, and two staff-only tables (`staff_flags`, `contact_attempts`); a new append-only map in `rls.ts` (read and insert for the parties, never update or delete). The contact check is a pure function in `packages/domain/src/chat/contact-check.ts`, called by every free-text write (chat, request description, quote scope, booking note). Delivery is polling first behind one mobile hook; Neon Realtime replaces it only if it supports row-level-security-scoped subscriptions.

**Tech Stack:** existing: Drizzle + Postgres RLS (`packages/db`), zod contract, domain modules, Next.js route handlers, Refine back office, Expo app, sharp (already used by `photos.ts`), vitest, jest. Nothing new is installed.

**Spec:** `docs/superpowers/specs/2026-10-29-stage-2-booking-and-money-design.md` (section 3.10; 3.1 for request photos; 9 and 9a for the AI layer). Builds on `docs/superpowers/plans/2026-10-29-stage-2a-requests-quotes-bookings.md` (plan 2a): its tables `requests`, `quotes`, `bookings`, its functions `createRequest`, `sendQuote`, `acceptQuote`, `createDirectBooking`, `notifyBookingEvent`, and `apps/mobile/src/api/bookings.ts` are used unchanged except where a step says otherwise. Read `apps/web/AGENTS.md` and `apps/mobile/AGENTS.md` before writing Next or Expo code.

## Global Constraints

- Everything user-facing exists in German and English (`packages/i18n/src/en.ts` and `de.ts`, same keys; `packages/i18n/src/index.test.ts` enforces it). No competitor names. No "Treuhand", "Escrow" or "Garantie" in any text; say "payment protection" / "Zahlungsschutz".
- The rejection text is exactly (spec 3.10), keys `chat.contactBlocked`:
  - EN "Contact details can't be shared here. Please keep the conversation in the app: payment protection, reviews and our help with disputes only apply to what happens in the app."
  - DE "Kontaktdaten können hier nicht geteilt werden. Bitte bleibt in der App: Zahlungsschutz, Bewertungen und unsere Hilfe bei Streitfällen gelten nur für das, was in der App passiert."
- Contact details (phone numbers, emails, links, numbers in German or English words, spaced digits) are blocked at every stage, before and after payment. Street addresses, postcodes, prices, dates and times are not blocked. A blocked message is rejected, never edited or stored in the thread. Numbers inside photos are not checked in this release.
- The AI check is NOT built. One marked extension point only; it may be added once an EU provider and a data processing agreement exist (spec 9a, README step 19).
- One thread per request or per booking; text and photos only; messages cannot be edited or deleted; readable by the two people, and by staff only for a reported message's thread or a disputed booking.
- Constants (my calls, one place each, `packages/domain/src/chat/rules.ts`): `MAX_MESSAGE_CHARS = 2000`; `CONTACT_ATTEMPTS_LIMIT = 3` blocked attempts within `CONTACT_ATTEMPTS_WINDOW_HOURS = 24` flag the sender to staff; `CHAT_EMAIL_THROTTLE_MINUTES = 30` (at most one "new message" email per thread and recipient); `POLL_SECONDS = 4` (mobile); photo signed links last 600 seconds; photo size limit is the existing `MAX_PHOTO_BYTES`.
- Enums are `text` plus `check(...)`. Migration numbers continue after plan 2a's `0014`: this plan uses `0015`. Every new table is classified in exactly one map in `packages/db/src/rls.ts` and gets an isolation test; `cleanupUsers()` in `apps/web/tests/helpers.ts` deletes from every new table first.
- Currency stays the literal `'EUR'` as today; no new Germany-only assumptions (the number-word lists are per language, not per country).
- The owner merges every pull request; a test report goes in `Reports/`; no AI co-author or "Generated with" lines.

## Review Focus

- A blocked user who tries to send through the API directly (not the app): the insert is refused by the database policy, not only by the domain (Task 1 test `a blocked party's raw insert is refused by RLS`).
- A message that is a price, a date or an address with a postcode ("1.250,00 €", "am 29.10.2026 um 10:30", "Hauptstraße 12, 10115 Berlin"): it is sent; the unit table in Task 2 pins each.
- The blocked attempt must be counted even though the request fails and its transaction rolls back (Task 3 test `three blocked attempts in a day create one staff flag`).
- A third person, or a staff member without a reason, opening a thread by id: 404 (Task 3 and Task 6 tests).
- Two messages sent in the same millisecond: polling with the `after` cursor returns both, never one twice (Task 4 test `cursor pagination returns each message once`).

## File structure

- `packages/db/src/schema/chat.ts` (new): `threads`, `messages`, `blocks`, `staff_flags`, `contact_attempts`; export from `schema/index.ts`. Modify `schema/notifications.ts` (kind `message-received`). Migration `packages/db/migrations/0015_chat.sql` (generated).
- `packages/db/src/rls.ts`: new map `APPEND_ONLY_TABLES`; definer function `is_blocked`.
- `packages/contract/src/chat.ts` (new).
- `packages/domain/src/chat/rules.ts`, `contact-check.ts`, `threads.ts`, `messages.ts`, `blocks.ts`, `flags.ts` (new); `packages/domain/src/photos.ts` (extract `normalizeImage`); plan 2a's `bookings/requests.ts`, `bookings/bookings.ts` (create threads, post cards, run the check).
- Routes: `apps/web/app/app-api/v1/threads/route.ts`, `threads/[id]/messages/route.ts`, `threads/[id]/photos/route.ts`, `messages/[id]/report/route.ts`, `blocks/route.ts`, `blocks/[userId]/route.ts`; admin `apps/web/app/api/admin/threads/[id]/route.ts`, `apps/web/app/admin/flags/page.tsx`.
- Mobile: `apps/mobile/src/api/chat.ts` (+ test), `apps/mobile/src/hooks/use-thread-messages.ts`, `apps/mobile/src/screens/chat/*`.

### Task 1: Tables and row-level security

**Files:** Create `packages/db/src/schema/chat.ts`, migration `0015_chat.sql`; modify `schema/index.ts`, `schema/notifications.ts`, `rls.ts`, `apps/web/tests/helpers.ts`; test `apps/web/tests/rls-chat.int.spec.ts`.

**Interfaces:**
- Consumes: plan 2a's `requests.id`, `bookings.id`, `providers.id`, `users.id`.
- Produces (columns):
  - `threads`: `id`, `requestId` (nullable, unique), `bookingId` (nullable, unique), `customerId`, `providerId`, `createdAt`; check exactly one of `requestId`, `bookingId` is set.
  - `messages`: `id`, `threadId`, `senderId`, `kind` check `text|photo|card`, `body` (nullable text), `photoKey` (nullable), `card` (nullable jsonb `{type: 'quote'|'acceptance'|'additional-task', refId, amount?, currency?, version?}`), `createdAt`; check: `text` has a body, `photo` has a key, `card` has a card; index `(thread_id, created_at, id)`.
  - `blocks`: `blockerId`, `blockedId`, `createdAt`, primary key `(blocker_id, blocked_id)`.
  - `staff_flags`: `id`, `kind` check `contact-attempts|message-reported` (later plans widen it), `refId` text, `userId` (nullable), `note` (nullable), `createdAt`, `resolvedAt` (nullable), `resolvedBy` (nullable); unique `(kind, ref_id, user_id)` where `resolved_at IS NULL`.
  - `contact_attempts`: `id`, `userId`, `threadId` (nullable), `hit` text, `text` text, `createdAt`.
  - `rls.ts`: `APPEND_ONLY_TABLES: Record<string, { read: string; insert: string }>` (grant SELECT and INSERT only, policies `public_read`-style `party_read` and `party_insert`; add both names to `POLICY_NAMES`; include in `classifyTables` and the default `rlsStatements` list). Entries: `threads` (read and insert: the party expression of plan 2a on `customer_id`/`provider_id`), `messages` (read: party of the thread; insert: `sender_id = app_current_user_id()` AND party AND `NOT is_blocked(<customer_id>, <provider owner id>)`). `blocks` in `PRIVATE_TABLES` (`blocker_id = app_current_user_id()`). `staff_flags`, `contact_attempts` in `STAFF_ONLY_TABLES`.
  - Definer function `is_blocked(p_a text, p_b text) RETURNS boolean` (either direction; needed because the blocker's row is invisible to the blocked user under RLS), `REVOKE ALL FROM PUBLIC`, `GRANT EXECUTE TO app_user`, `SET search_path = public, pg_temp`.
  - Notification kind added: `message-received`.

- [ ] **Step 1: Write `rls-chat.int.spec.ts`**: `both parties read the thread and its messages; a third user reads none`, `app_user cannot update or delete a message, even their own` (expect permission denied), `a party cannot insert a message as the other party`, `a blocked party's raw insert is refused by RLS`, `blocks are visible only to the blocker`, `app_user cannot read staff_flags or contact_attempts`; `db-migrations.int.spec.ts` must still pass.
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run tests/rls-chat.int.spec.ts tests/db-migrations.int.spec.ts`: FAIL (tables missing).
- [ ] **Step 3: Implement** the schema in the style of plan 2a's `bookings.ts`, the new map and function in `rls.ts`, `pnpm db:generate` for `0015` (if drizzle-kit does not emit the widened `notifications_kind_check`, hand-write it into `0015` as plan 2a did in `0013`); add the new tables to account deletion (`ACCOUNT_TABLES` and the deletion order in `packages/domain/src/account.ts`, which has a guard test) as plan 2a's Task 1 did; add `message-received` to the contract's `NOTIFICATION_KINDS` list and the exhaustive kind-to-text map in `apps/mobile/src/lib/notification-text.ts` (German and English) so the app renders it. Add the five tables to `cleanupUsers()` before plan 2a's tables (`contact_attempts`, `staff_flags`, `messages`, `threads`, `blocks`).
- [ ] **Step 4: Run** the Step 2 command: PASS.
- [ ] **Step 5: Commit** `feat(db): chat threads, messages, blocks and staff flags`.

### Task 2: The contact-detail check (pure function)

**Files:** Create `packages/domain/src/chat/rules.ts`, `packages/domain/src/chat/contact-check.ts`; test `packages/domain/src/chat/contact-check.test.ts`.

**Interfaces:**
- Produces: the constants of Global Constraints in `rules.ts`; `type ContactHit = 'phone' | 'email' | 'link'`; `findContactDetails(text: string): ContactHit | null` (pure, synchronous); `checkContactDetails(text: string): Promise<ContactHit | null>` (calls `findContactDetails`; contains the one marked comment `// EXTENSION POINT (not built): AI check of text that passed the rules, only after an EU provider and a data processing agreement exist (spec 9a). Must never send text anywhere until then.`).
- Algorithm (the order matters; the tests decide the details):
  1. Lower-case; normalise Unicode (NFKC) so full-width digits count.
  2. Email: `x@y.tld`, and spelled forms `x (at) y . tld`, `x [at] y punkt tld`, `x at y dot tld` (the `at`/`ät` form only counts when followed by a domain-like word and `dot`/`punkt`/`.` and 2+ letters).
  3. Link: `http(s)://`, `www.`, and a bare `word.tld` where tld is one of `de com net org eu io me info app co za at ch` (list in `rules.ts`).
  4. Remove dates (`d.m.yy`, `d.m.yyyy`), times (`10:30`, `10.30 uhr`), and prices (a number with optional thousands dots and `,dd`, next to `€`, `eur` or `euro`).
  5. Replace number words with digits when they stand in a run of 3 or more number tokens (words or digits): DE `null eins zwei zwo drei vier fünf fuenf sechs sieben acht neun`, EN `zero oh one two three four five six seven eight nine` (`ein` and `one` alone never count).
  6. Join digit groups separated by single spaces, `.`, `-`, `/`, `(`, `)` (never by a comma or a line break). A joined run is a phone number when it has 7 or more digits and starts with `0`, `+` or `00`, or has 10 or more digits.
- [ ] **Step 1: Write the table test** (`it.each`), each row `[text, expected]`:

| Blocked (expected hit) | Allowed (expected `null`) |
|---|---|
| `Ruf mich an: 0151 23456789` → phone | `Das kostet 1.250,00 €` |
| `0 1 5 1 2 3 4 5 6 7 8 9` → phone | `Preis: 85 EUR pro Stunde, 3 Stunden` |
| `+49 30 1234567` → phone | `Hauptstraße 12, 10115 Berlin` |
| `0049-30-123-4567` → phone | `Hauptstraße 123a, 01067 Dresden` |
| `(030) 123 45 67` → phone | `Am 29.10.2026 um 10:30 Uhr` |
| `null eins fünf eins zwei drei vier fünf sechs sieben acht` → phone | `Ich komme um 10.30 Uhr, ca. 2 Stunden` |
| `zero one five one two three four five six seven eight` → phone | `Ich habe eine Frage zu einem Termin` |
| `null eins 5 eins 2345678` → phone | `One more thing: bring two ladders` |
| `max@example.de` → email | `Wohnung im 3. Stock, Tür 12` |
| `max (at) example punkt de` → email | `Auftrag Nr. 4711` |
| `max at gmail dot com` → email | `We meet at home at 5` |
| `www.example.de` → link | `z.B. am Montag, usw.` |
| `https://wa.me/49151` → link | `Größe 120 x 80 cm` |
| `schreib mir auf example.com` → link | `Ich bin um 9 da, Postleitzahl 10115` |

- [ ] **Step 2: Run** `pnpm --filter @kando/domain test`: FAIL.
- [ ] **Step 3: Implement** `findContactDetails` and `checkContactDetails` as above; no network, no AI.
- [ ] **Step 4: Run**: PASS (every row). **Step 5: Commit** `feat(domain): rules-based contact-detail check`.

### Task 3: Threads, messages, cards, and the check on every free-text write

**Files:** Create `packages/contract/src/chat.ts`, `packages/domain/src/chat/threads.ts`, `messages.ts`, `flags.ts`; modify `packages/domain/src/photos.ts`, plan 2a's `bookings/requests.ts` and `bookings/bookings.ts`, `packages/domain/src/index.ts`, `packages/contract/src/index.ts`; routes `threads/route.ts` (GET list), `threads/[id]/messages/route.ts` (GET, POST), `threads/[id]/photos/route.ts` (POST multipart); test `apps/web/tests/chat.int.spec.ts`.

**Interfaces:**
- Consumes: Task 1 tables; Task 2 `checkContactDetails`; plan 2a's `createRequest`, `sendQuote`, `acceptQuote`, `createDirectBooking`, `fail`, `AfterCommit`, `storage()`, `documentsBucket()`.
- Produces:
  - Contract: `MessageInputSchema {body: text(1..MAX_MESSAGE_CHARS)}`, `MessageSchema {id, threadId, mine: boolean, kind, body: string|null, photoUrl: string|null, card: CardSchema|null, createdAt}`, `CardSchema` (discriminated on `type`), `ThreadSchema {id, requestId: string|null, bookingId: string|null, otherName: string, lastMessageAt: string|null, blocked: boolean}`, `MessagesQuerySchema {after?: string}` (opaque cursor `<createdAt ISO>|<id>`).
  - `threadForRequest(tx, requestId: string): Promise<string>` and `threadForBooking(tx, bookingId: string): Promise<string>` (create on first use; a booking made from a quote uses its request's thread, found through `quoteId`; a booking with plan 2d's `parentBookingId` uses its parent's thread; a direct booking gets its own).
  - `postCard(tx, threadId: string, senderId: string, card: Card): Promise<void>`.
  - `assertNoContactDetails(userId: string, text: string, threadId?: string): Promise<void>`: runs `checkContactDetails`; on a hit, records a `contact_attempts` row and, when the count reaches `CONTACT_ATTEMPTS_LIMIT` in the window, calls `flagForStaff`, both on the owner connection `db` (so they survive the rollback), then throws `fail(422, { error: 'CONTACT_DETAILS' })`.
  - `flagForStaff(exec: Exec, flag: { kind: StaffFlagKind; refId: string; userId?: string; note?: string }): Promise<void>` (insert, ignore the unique conflict: one open flag per kind, ref and user). `StaffFlagKind` is the `staff_flags.kind` union, widened by later plans.
  - `sendMessage(tx, userId, threadId, input: MessageInput, afterCommit: AfterCommit): Promise<Message>`, `sendPhoto(tx, userId, threadId, photo: NormalizedImage, afterCommit): Promise<Message>`, `listMessages(tx, userId, threadId, after?: string): Promise<Message[]>` (oldest first, at most 100, photo links signed for 600 seconds), `listThreads(tx, userId): Promise<Thread[]>`.
  - `photos.ts`: `normalizeImage(bytes: Buffer): Promise<NormalizedImage>` where `NormalizedImage = { data: Buffer; width: number; height: number }`, extracted from `preparePhoto` (which then calls it); `prepareChatPhoto(request: Request): Promise<NormalizedImage>` (form field `file`, same limits).
- Changes to plan 2a's functions: `createRequest` creates the request's thread; `sendQuote` posts a `quote` card (amount, version); `acceptQuote` posts an `acceptance` card; `createDirectBooking` creates the booking's thread. `createRequest` (description), `sendQuote` (scope) and `createDirectBooking`/`answerBooking` (note) call `assertNoContactDetails` first. Photos on requests (deferred by plan 2a) are chat photos posted to the request's thread right after the request is created; no new table.
- [ ] **Step 1: Write tests**: `creating a request opens a thread; both parties list it`, `a quote and its acceptance appear as cards in the request's thread`, `a booking from an accepted quote shares the request's thread; a direct booking gets its own`, `text message round trip; the other side sees mine: false`, `a message with a phone number is 422 CONTACT_DETAILS and nothing is stored`, `a request description or quote scope with an email is 422`, `three blocked attempts in a day create one staff flag` (assert `staff_flags` has one `contact-attempts` row and `contact_attempts` three rows), `a photo is stored in the private bucket and listed with a signed link` (use `memoryStorage()`), `a 2001-character message is 400`, `a third user gets 404 on list, send and photo`, `cursor pagination returns each message once` (two rows with the same `created_at`).
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run tests/chat.int.spec.ts`: FAIL.
- [ ] **Step 3: Implement** the functions and routes in the `appRequest({ auth: 'required' })` pattern (photos route uses `prepare: prepareChatPhoto` like `files/route.ts`); the photo object is written before the row and removed in `afterCommit` cleanup on failure, as `addPhoto` does. Photo key `chat/<threadId>/<uuid>.jpg` in `documentsBucket()`.
- [ ] **Step 4: Run** the file and plan 2a's `requests-quotes.int.spec.ts` and `bookings.int.spec.ts`: PASS.
- [ ] **Step 5: Commit** `feat: chat threads, messages, photos and cards`.

### Task 4: Report, block, and the new-message notice

**Files:** Create `packages/domain/src/chat/blocks.ts`; routes `messages/[id]/report/route.ts` (POST), `blocks/route.ts` (GET, POST), `blocks/[userId]/route.ts` (DELETE); modify plan 2a's `bookings/notify.ts`, `email.ts` (template `message-received`), `notifications-store.ts`, `packages/i18n/src/en.ts` and `de.ts`; test `apps/web/tests/chat-safety.int.spec.ts`.

**Interfaces:**
- Consumes: Task 3 `flagForStaff`, `sendMessage`; plan 2a's `notifyBookingEvent(kind, userId, params)`.
- Produces: `ReportInputSchema {reason: text(1..500)}`; `reportMessage(tx, userId, messageId, input: ReportInput): Promise<void>` (party of the thread only, not their own message; `flagForStaff({kind: 'message-reported', refId: messageId, userId, note: reason})`); `blockUser(tx, userId, otherId): Promise<void>` (only someone the caller shares a thread with), `unblockUser(tx, userId, otherId): Promise<void>`, `listBlocks(tx, userId): Promise<{userId: string; name: string}[]>`.
- Block effect (my call): no messages either way in any shared thread; a blocked customer cannot create a new request or direct booking with the blocker's provider (404, as for an unpublished provider); existing bookings, cards, payments and timers carry on, so money and evidence are never stuck. `ThreadSchema.blocked` tells the app to hide the input and show `chat.blocked` text.
- New-message notice: `sendMessage` and `sendPhoto` call `notifyBookingEvent('message-received', otherUserId, { url })` in `afterCommit`, at most once per thread and recipient per `CHAT_EMAIL_THROTTLE_MINUTES` (check the latest `message-received` notification's payload `threadId`). Plan 2e adds push.
- [ ] **Step 1: Write tests**: `reporting a message creates one staff flag; reporting it twice does not add another`, `a user cannot report their own message (400) or one in another thread (404)`, `after a block, neither side can send (403 BLOCKED) and the thread says blocked: true`, `a blocked customer cannot create a request to the blocker's provider (404)`, `unblock restores sending`, `two messages within 30 minutes send one email; one after 31 minutes sends another` (pass the time through the notification's `created_at`).
- [ ] **Step 2: Run**: FAIL. **Step 3: Implement**; add the i18n keys `chat.contactBlocked` (exact texts above), `chat.blocked`, `chat.report.*`, `notification.message-received`, `email.messageReceived.subject/.body` (the email never contains the message text, only that there is a new message and the app link). **Step 4: Run** the file and `pnpm --filter @kando/i18n test`: PASS.
- [ ] **Step 5: Commit** `feat: report, block and new-message notices`.

### Task 5: Mobile chat

**Files:** Create `apps/mobile/src/api/chat.ts` (+ `chat.test.ts`), `apps/mobile/src/hooks/use-thread-messages.ts`, `apps/mobile/src/screens/chat/{thread-list,thread,message-bubble,card-bubble}.tsx`, routes `apps/mobile/src/app/chat/**`; modify `apps/mobile/src/screens/bookings/request-form.tsx` and `booking-detail.tsx` (plan 2a) to add photos and an "Open chat" entry, `apps/mobile/src/i18n/index.ts` (map `CONTACT_DETAILS` to `chat.contactBlocked`, `BLOCKED` to `chat.blocked`).

**Interfaces:**
- Consumes: Task 3 and 4 routes and contract types; `api`, `upload`, `PickedFile` from `@/api/client`.
- Produces: in `api/chat.ts`: `listThreads()`, `listMessages(threadId, after?)`, `sendMessage(threadId, body)`, `sendPhoto(threadId, file: PickedFile)`, `reportMessage(id, reason)`, `blockUser(userId)`, `unblockUser(userId)`; hook `useThreadMessages(threadId: string): { messages: Message[]; send(body: string): Promise<void>; sendPhoto(file: PickedFile): Promise<void>; error: string | null }`.
- Live delivery: the hook polls `listMessages(threadId, lastCursor)` every `POLL_SECONDS` while the screen is focused and the app is in the foreground, and appends. Before building, check the current Neon Realtime documentation (the `neon:neon-realtime` skill or neon.com docs): if it offers subscriptions that respect the app's row-level security for a signed-in user, replace the timer inside this hook only and keep polling as the fallback when the subscription drops; if not, polling stays and the README "Not built" list says so.
- A rejected message keeps its text in the input so the sender can rewrite and resend; the rejection text appears under the input. Every bubble from the other side has "Report"; the thread menu has "Block". Card bubbles show the quote amount and version, "Quote accepted", or "Additional task".
- [ ] **Step 1: Write `chat.test.ts`** asserting each call's path, method and body, and a hook test with fake timers: `polls with the last cursor and appends`, `stops polling when unfocused`.
- [ ] **Step 2: Run** `pnpm --filter mobile test`: FAIL. **Step 3: Implement** the API module, hook and screens (texts from `@kando/i18n`). **Step 4: Run** `pnpm --filter mobile test`, `npx tsc --noEmit`, `npx expo lint` in `apps/mobile`: PASS.
- [ ] **Step 5: Commit** `feat(app): chat with photos, report and block`.

### Task 6: Staff access and the flags list

**Files:** Create `apps/web/app/api/admin/threads/[id]/route.ts`, `apps/web/app/admin/flags/page.tsx`, `apps/web/app/api/admin/flags/[id]/resolve/route.ts`; modify `packages/domain/src/admin/resources.ts` (`flags` read resource, Reviewer may read), `apps/web/app/admin/admin-shell.tsx` (menu entry), admin i18n keys; test `apps/web/tests/admin-chat.int.spec.ts`.

**Interfaces:**
- Consumes: Task 1 tables, existing `requireStaff`/`roleFor` patterns and `adminCall` test helper.
- Produces: `staffMayReadThread(exec: Exec, threadId: string): Promise<boolean>` (true when a message of the thread has an open or resolved `message-reported` flag; plan 2d widens it to disputed bookings); `staffThread(exec, threadId): Promise<Message[]>` (404 unless `staffMayReadThread`); the `flags` list (kind, user, created, resolved) with a link to the thread when there is one, and `resolveFlag(exec, staffId, id)`.
- [ ] **Step 1: Write tests**: `staff read a thread with a reported message`, `staff get 404 for a thread with no reason`, `a reviewer lists flags; only an administrator resolves one`, `the contact-attempts flag shows the blocked texts to staff`.
- [ ] **Step 2: Run**: FAIL. **Step 3: Implement** in the existing resource and action-route style, German and English labels. **Step 4: Run**: PASS. **Step 5: Commit** `feat(admin): staff thread access and flags`.

### Task 7: Check and report

**Files:** Create `Reports/Stage-2b-Test-Report.xlsx` (same sheets as earlier reports); modify `README.md` ("What the app does today", "Not built": the AI chat check and numbers in photos; whether realtime or polling is used).
- [ ] **Step 1: Run** `pnpm typecheck && pnpm lint && pnpm test`; record the counts. **Step 2: Add** phone-test rows (send text, photo, blocked phone number in digits and in words, report, block, request with photos). **Step 3: Commit** `docs: stage 2b report and README`. The owner merges.

### Task 8: Carry-over from the Stage 2a review (abuse limits and the data export)

**Files:** modify `packages/domain/src/bookings/requests.ts`, `bookings/bookings.ts`, `packages/domain/src/export.ts`, `packages/contract/src/*` as needed, `packages/i18n/src/en.ts` and `de.ts`, mobile error mapping; tests `apps/web/tests/abuse-limits.int.spec.ts`, `apps/web/tests/export-bookings.int.spec.ts`.

**Interfaces:**
- Produces: constants `MAX_OPEN_REQUESTS_PER_PAIR = 1` and `MAX_REQUESTS_PER_DAY = 10` in `packages/domain/src/bookings/rules.ts` (my calls); `createRequest` refuses (409 `request-limit`) a second `open` or `quoted` request from the same customer to the same provider and more than `MAX_REQUESTS_PER_DAY` requests plus direct bookings per customer in 24 hours (409 `daily-limit`); the data export (`Export my data`, JSON and CSV) includes the person's own requests, quotes, bookings (as customer or provider) and chat messages they sent, with the job address only where the person is the customer.
- [ ] **Step 1: Write tests**: `a second open request to the same provider is 409 request-limit; after it expires or is booked a new one is allowed`, `the 11th request or direct booking in 24 hours is 409 daily-limit`, `the export contains my requests, quotes, bookings and my sent messages and nothing of other people's`, `a provider's export does not contain the customer's address`.
- [ ] **Step 2: Run**: FAIL. **Step 3: Implement**, with German and English error texts and the mobile error mapping. **Step 4: Run** the files plus the existing export test: PASS.
- [ ] **Step 5: Commit** `feat: request limits and booking data in the export`.

## Self-review

- **Spec coverage (3.10):** one chat per request or booking, text and photos: Tasks 1, 3; readable by the two and by staff with a reason: Tasks 1, 6 (dispute access arrives with plan 2d); immutable: Task 1 (no update or delete grant); cards: Task 3; report and block: Task 4; live delivery: Task 5 (push is plan 2e, email here); contact details blocked at every stage including words and spaced digits, exact texts, rewrite and resend, repeated attempts flagged: Tasks 2, 3, 5; AI layer only an extension point: Task 2; addresses not blocked: Task 2 table. 3.1 request photos: Task 3.
- **Types:** uses plan 2a names verbatim (`requests`, `quotes`, `bookings`, `quoteId`, `providerId`, `customerId`, `notifyBookingEvent`, `createRequest`, `sendQuote`, `acceptQuote`, `createDirectBooking`, `answerBooking`). New names reused by later plans: `threadForBooking`, `postCard`, `Card` (`additional-task` type used by plan 2d), `flagForStaff`, `StaffFlagKind`, `staff_flags`, `staffMayReadThread`, `assertNoContactDetails`, `APPEND_ONLY_TABLES`.
- **Proportion:** seven tasks, signatures, values and tests; the contact-check algorithm is described because the tests alone do not determine its order.
