# Plan: Feedback form (PR 6), Help content (PR 7a), Help search (PR 7b)

Status: PLAN, not started. Nothing here is built. Start after PR 5 (#99) is merged. One branch and one pull request each, owner merges.
Starting point: the banner (`apps/mobile/src/components/screen-banner.tsx`) already shows Help and Feedback buttons on every screen except Home; both open a "Coming soon." placeholder.

## Owner decisions (9 November 2026)

1. **Signed-out people can send feedback**, with a stricter limit. Limits (owner set the signed-out ones; one constant, easy to change): signed out 1 per hour and 1 per day per IP address; signed in 5 per hour and 10 per day per account (owner confirmed). A message over 2000 characters or an empty one is refused before it counts.
2. **Help opens as a full screen** with the search box on top; back returns to the same screen.
3. **Home gets the Help and Feedback buttons in the bottom right corner of its hero bar** (owner decision, the same corner as on the other screens' banners). This reverses the earlier "do not change Home": only the two buttons are added, nothing else on Home changes. Build it in PR 6 (the buttons) so Home has them from the start.
4. Feedback is only emailed, not stored (nothing to delete later). The privacy policy says the email is kept in the info@skillweb.space mailbox.
5. I draft the Help texts; the owner and the lawyer approve the money and governance topics before they are published (PR 7a).

## PR 6: Feedback form

Goal: tap "Feedback" in the banner, a form opens (email, comment), "Send" emails info@skillweb.space.

- **Contract** (`packages/contract/src/feedback.ts`, new): `FeedbackInputSchema` = `{ email: string (valid, max 254), message: string (trimmed, 1 to 2000) }`. Signed-in people: email is prefilled from the account but editable.
- **Domain** (`packages/domain/src/feedback.ts`, new): `sendFeedback(input, who)` builds the mail with the existing mail sender in `packages/domain/src/email.ts` (`to` info@skillweb.space, `replyTo` the sender's email so the owner can answer, subject "Feedback from the app", body with the message and, for signed-in people, the user id and app language). Mail text is plain: the comment is escaped (`esc`) in the HTML part. The `to` address comes from one constant, never from the request. Check how `email.ts` treats a template (`Template` union, `EMAIL_KEYS`, `notification-parity.int.spec.ts`): the feedback mail goes to the owner, so it is not a user notice; add it as its own small function rather than a user template, so the parity test is not affected.
- **Route** `apps/web/app/app-api/v1/feedback/route.ts`: `POST`, built with `appRequest` (origin check, body size cap), allowed signed out. Rate limit: look at how `packages/domain/src/app-request.ts` limits requests and reuse it; 1 per hour and 1 per day per IP when signed out, 5 per hour and 10 per day per account when signed in. Answer `{ ok: true }` only after the mail call returned. If the mail service fails: a 502 with a plain error text, nothing lost silently. Add the route to the guard list in `apps/web/tests/app-endpoints-wrapped.int.spec.ts` as needed.
- **Phone**: `apps/mobile/src/components/feedback-form.tsx` (a modal sheet opened from `ScreenBanner`, replacing the Feedback placeholder): email field, multiline comment field with a counter, Send, Cancel, a thank-you state, an error state with retry; keyboard handling like the other forms (`KeyboardAwareScrollView`). `apps/mobile/src/api/feedback.ts` posts it. Help stays a placeholder until PR 7b.
- **i18n** (de, en): title, field labels, hints, "Thank you, we read every message", errors (invalid email, empty, too long, rate limit, send failed).
- **Legal text**: one line in the privacy policy (page text in `/admin`, both languages, production edited by the owner): feedback emails contain the email address and message, are kept in the support mailbox, deleted on request. Add to README "owner steps".
- **Tests**: unit (schema limits, mail builder escapes HTML and sets `replyTo`); integration (signed-in and signed-out send reach the outbox with `to` info@skillweb.space; invalid email 400; too long 400; sixth call inside the hour 429); phone test for the form states. Browser check at phone size with the web test harness.
- **Done when**: the mail arrives in the outbox with the right address in tests and in one real test with the Resend key, the form works signed in and out, both languages read well.

## PR 7a: Help content (no search yet)

Goal: a Help screen with the topics, readable and browsable, in German and English.

- **Where the texts live**: `packages/i18n` is for screen text; Help topics are content that will be searched and embedded, so they go in one reference table `help_topics` (id, slug, sort, `title_de`, `body_de`, `title_en`, `body_en`, `updated_at`), filled by a seed script and editable later in `/admin`. This table is the same one PR 7b adds the embedding to. Decide now to avoid two migrations: **create the table with the embedding columns in PR 7a? No: create it in PR 7a without embeddings; PR 7b adds the vector column.** Migration number: next free after 0037 (the column-drop migration), check the folder first. Classify `help_topics` in `packages/db/src/rls.ts` as a published-read reference table with an isolation test (everyone reads, only the owner connection writes). Production: migration before the code that reads it is deployed.
- **Contract and route**: `HelpTopicSchema`; `GET /app-api/v1/help` returns all topics in the request language (small, a few dozen rows; cached for a day), allowed signed out.
- **Phone**: `apps/mobile/src/screens/help/help-screen.tsx` and route `app/help.tsx`: a banner like the other screens, the opening topic expanded at the top, the other topics as a collapsible list, grouped (Using the app, Booking and paying, Providers, Money and fees, Safety and rules, Your data). The banner Help button navigates here. A search box is shown from PR 7b; leave it out now.
- **Topics to write** (draft, then approval):
  1. **What SkillWeb is and how it works** (the required opening: short and clear). A marketplace: households find document-checked local helpers, request, get a quote, pay, the job is done, the money is released, invoices are included.
  2. **How it is governed**: who runs it, what we check (documents, ID), what happens in a dispute, who decides, house rules, suspension. **Needs owner and lawyer approval.**
  3. **Where the money is kept**: the customer pays through Stripe; the money stays on the platform's Stripe balance until the job is done and then goes to the provider; commission (15%, incl. payment fees, provisional until the owner confirms); refunds and holds. **Needs owner and lawyer approval; check it against the live terms page.**
  4. Then one short topic per screen and rule: finding providers, sending a request, quotes, paying, jobs list, cancelling and the late-cancel rule, additional tasks, stopping a job, disputes, reviews, invoices and receipts, provider setup and documents, payout setup, commission invoices, the provider money strip, account and data export, deleting the account, notifications, languages.
  Each topic: title, 2 to 6 sentences, no competitor names, no promises the rules do not keep, German is the main text.
- **Do not publish** topics 2 and 3 until the owner and the lawyer have approved the wording; the table seed can hold them in an `approved` flag (`false` hides them from the route) so the PR can merge without them.
- **Tests**: seed script is idempotent; route returns de and en, hidden topics are not returned; isolation test; phone test (opening topic first, list opens and closes); every topic has both languages (a test that fails on an empty German or English field); browser check.
- **Done when**: the owner has read all topics in both languages and approved or hidden the sensitive ones.

## PR 7b: Help search (keyword and vector)

Goal: search box on Help; exact words and related topics are found; nothing unrelated is returned.

- **Migration** (next free number, also on production before deploy): `CREATE EXTENSION IF NOT EXISTS vector` (check it is available on the Neon plan first; test on the dev branch) and add `embedding vector(<dim>)` to `help_topics` plus an HNSW or plain index (a few dozen rows: **no index needed**, an exact scan is fast and exact). The dimension must match the embedding model; pick the model first (OpenRouter embedding model, multilingual so German and English both work) and write its name and dimension in the code as one constant.
- **Embedding the topics**: script `packages/domain/src/help/embed.ts` run on seed and when a topic changes (also from `/admin` save): one embedding per topic and language from `title + body`, stored with the model name so a model change forces a rebuild. `OPENROUTER_API_KEY` (already used by `translate.ts` and the document check) is read only on the server.
- **Search** `GET /app-api/v1/help/search?q=...` (signed out allowed, rate limited, `q` 2 to 100 characters):
  1. Keyword part: Postgres full-text search in the request language (`simple` or `german`/`english` configuration), plus a prefix match on titles.
  2. Vector part: embed the query once (a small call), cosine similarity against the topics of that language.
  3. Merge: a topic is returned if its keyword rank is above zero **or** its similarity is at or above a **minimum score**; keyword hits first, then by similarity; at most 6 results. **The minimum score is chosen from a test list, not guessed** (see tests); below it, return an empty list and the phone shows "No help topic found. Send us feedback" with a button to the Feedback form.
  4. If the embedding call fails or the key is missing: fall back to keyword only (never an error screen).
- **Phone**: the search box on the Help screen (debounced, 300 ms), results as a list of topics that open in place, empty state with the Feedback link, loading and error states.
- **AI disclosure** (CLAUDE.md rule 10): the searched text goes to the AI provider. Add a line to the terms and privacy policy (both languages, owner edits production); search text is not stored; nothing on screen, since it returns our own texts, not AI-written text. Re-check the "delete my data" path: nothing stored, so nothing to delete (state that in the DPIA notes).
- **Tests** (`help-search.int.spec.ts` and a fixture of example searches in both languages):
  - Exact words and phrases return the right topic ("refund", "Rückerstattung", "commission", "Provision").
  - Related wording returns the right topic with no shared word ("when do I get my money back" returns Money; "was passiert wenn ich absage" returns Cancelling).
  - **Nonsense and off-topic searches return nothing** ("asdfgh", "pizza recipe", "weather tomorrow", "bitcoin price"): the minimum score is set so every fixture passes; the fixture is the guard against garbage.
  - The key missing gives keyword results, not an error; rate limit works; German searches never return English-only results.
  - These use the real model on the dev key, so they are tagged as a slow suite and skipped in CI unless the key is set; unit tests cover the merge and threshold logic with fixed vectors.
- **Done when**: every fixture passes, the owner has tried ten searches of her own in both languages, and the terms and privacy lines are edited in production.

## Order and dependencies

PR 6 first (small, no database). PR 7a second (table, route, screen, content). PR 7b third (needs 7a's table and the approved topics to tune the threshold). The column-drop PR (migration 0037, README outstanding list) is independent and goes before 7a so the migration numbers stay in order.

## Outside the code (owner)

- Approve or change the three suggested answers above before PR 6 starts.
- Lawyer review of the governance and money topics before PR 7a publishes them.
- Edit production texts: privacy policy (feedback), terms and privacy (Help search and the AI provider).
- Confirm the Resend sender can deliver to info@skillweb.space and that someone reads that mailbox.
