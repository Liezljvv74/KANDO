# "Done" button on the screens people must fill in: design

Date: 11 November 2026. Status: DRAFT for the owner's approval; nothing is built.
Written after a question-and-answer session with the owner. Everything marked **Owner** was decided by her; everything marked **My call** is a decision made while writing this and can be changed.

## Why

People fill in screens in the phone app and cannot tell that their data is saved, and they do not know what to do next. The owner saw this: they "don't know what to do next and don't feel comfortable that the data is saved". Most screens save a field when the person leaves it (no button, no message), so nothing says "saved". The goal is confidence (it is saved) and guidance (here is the next thing).

## Goals

1. On every screen a person **must** complete, a **Done** button, fixed at the bottom of the screen, saves what was entered, shows "Saved", and takes the person to the next required screen that is still open.
2. If a required field is empty when Done is pressed, a friendly message says what is missing; the person stays on the screen.
3. When nothing required is left, the person is told everything is done. For a provider "required" includes uploading the photo ID (and any other required document) and setting up payouts, in that order, after the profile screens (**Owner**). A customer is taken to Search. A service provider is asked whether they want to change or add something; if not, they are told they will now be taken to publish, and are taken to the Publish switch.
4. After publishing, the provider is taken to where they can share the published profile and is reminded to share it. (**Owner**, confirmed on 11 November: "provider must be taken to the Share area and reminded to share".)

## Non-goals

- No Done button on optional screens (portfolio, past jobs/references, optional documents, profile picture). **Owner:** "Only on the screens they must complete".
- No Done button on document upload screens or on the payout set-up: they count as finished by themselves (see below). **Owner.**
- Not changing what is compulsory, what the server checks, or the Publish rules.
- No automatic publishing: the person flips the Publish switch themselves. **Owner:** "take them to the publish switch".
- Not removing the existing save-on-leave behaviour of the fields.

## Anti-goals (a failure even if it technically works)

- Showing "Saved" when the server did not accept the save (a network or server error must show the error, never "Saved").
- Taking a person to a screen that is already complete, or looping.
- Leaving the person with no hint of what to do after the last required screen.
- A Done button hidden behind the keyboard or below the fold.

## Who and where (decided)

**Owner:** both service providers and customers.

Required screens (those the app already treats as compulsory; the checklist, `apps/mobile/src/lib/live-checklist.ts`, and the server's `missing` list name them):
- **Account details** (everyone: name, postcode; a provider also the date of birth). Today the Account card has a Save button and a "Saved" message (`useFlash`, `screens/account-screen.tsx`). **Owner:** Done **replaces** Save there.
- **About you** (provider: type, business name, legal notice, strengths, skills, postcode, radius), `screens/my-profile/about-screen.tsx`.
- **Service** (provider: category, price type, price), `screens/my-profile/service-screen.tsx` (new and edit).

Not Done screens: documents (`document-screen.tsx`) and payouts (Stripe's hosted form). **Owner:** "Count them as finished automatically": they never get a Done button; the next-step logic simply treats an uploaded/submitted document and a sent payout form as no longer open.

## Behaviour (decided unless marked)

**Done pressed, everything required on this screen filled in**
1. Save what was entered (reuse the existing save calls; flush any text field still being typed, including tags typed but not yet added, `lib/pending-tags.ts`).
2. Only when the server accepted it: show **"Saved"** in the look the Account screen already has (`hooks/use-flash.ts`, **Owner:** "that look is fine" for every screen).
3. Go to the next open required screen (**My call**: after a short pause of about one second so "Saved" can be read; the exact timing is the builder's).

**Done pressed with a required field empty** (**Owner:** "Show a friendly message saying what is missing")
- Nothing is lost; the person stays; a friendly message names the missing fields in the person's language. Highlighting the fields is the builder's call.

**Which screen is next** (**My call**, built on what exists)
- The first item of `openItems(checklistItems(profile, docs))` that has a path (`lib/live-checklist.ts` maps each missing item and each rejected required document to its screen). Order: account details, then About you, then Service, then rejected required documents. The builder checks the order the server returns `missing` in and fixes it if it is not this one.
- **Owner:** a provider is sent to **upload the photo ID (and any other required document) and to set up payouts first**, before the "change or add something" question. So the next open item also covers a required document that was never uploaded (it is not in the server's `missing` list, the builder adds it from the documents list, `lib/documents.ts`) and the payout step (`quoteSteps`, `lib/do-quote-step.ts`, which opens Stripe's page). Order: account details, About you, Service, required documents, payouts.
- A document that is under our check (staff or the AI have it) is not open. A document or payout step that was just completed counts as finished by itself and the app moves on to the next open item without a Done press (**Owner:** "Count them as finished automatically"); coming back from Stripe's page continues the flow the same way.
- The `quoteSteps` list may hold more steps than payouts (for example the consent and the tax number, `lib/do-quote-step.ts`). The owner named only the photo ID and payouts. **My call:** only those two are in the flow; the builder checks the list and tells the owner if another step also blocks booking.

**Done on a screen that was already complete (coming back later to change something)** (**Owner:** "just Saved and back to where they were")
- Save, show "Saved", and go back to the screen the person came from. No "everything is done", no Search, no Publish prompt.
- **My call, how the app tells the two cases apart:** if no required item was open **before** this Done was pressed, it is an edit: Saved and back. If something was open before and this save leaves nothing open, it is the end of the flow: the "everything is done" steps below. If something is still open after the save, go to it.

**Nothing required left (the end of the flow)**
- Customer: show "everything is done", then go to **Search**. **Owner:** "The customer can be taken to Search."
- Provider: show "everything is done" and ask **"Do you want to change or add something?"** with two answers. **Owner.**
  - Yes: go to the My business page (the checklist overview) so they can change or add.
  - No: tell them **"You will now be taken to publish your profile"**, then go to the **Publish switch** (`screens/setup/publish-bar.tsx`, at the top of My business). The switch is not flipped for them.

**After publishing** (**Owner**, confirmed): the provider ends up where they can share the published profile (the live message with the Share button in `publish-bar.tsx`) and gets a short reminder to share. After sharing, they choose where to go (**Owner:** "After sharing, they can decide where to go to next").

**The button**
- **Owner:** fixed at the bottom of the screen, always visible. It must sit above the on-screen keyboard and not hide the last field (the screens use a keyboard-aware scroll).
- Label "Done" (German "Fertig"). **My call.**

## Constraints

- Every user-facing text exists in German and English (`packages/i18n`; German is the main language): "Done", "Saved", the missing-fields message, the "everything is done" messages, the change-or-add question and its answers, the "you will now be taken to publish" line, the share reminder.
- Per `CLAUDE.md`: one branch and one pull request per piece of work; the owner merges; per task run the affected tests and `tsc`; full suites at the end; no AI co-author lines; no new Germany-only assumptions.
- The phone app is built with Expo (expo-router); the change reaches users only with a new Android build.
- No database change is expected (the server's `missing` list and `underCheck` already exist). If the builder finds one is needed, stop and ask.

## To confirm with the owner

1. Whether "Done"/"Fertig" should also appear on the My business overview page itself (**My call**: no; it is not a screen where anything is typed).

## Left to the builder

- The shared component for the fixed bottom Done bar and how screens plug into it.
- How "next open screen" is computed and kept in step with the server's list after the save.
- The exact timing and placement of "Saved", wording of all texts (German checked by me, per the owner's rule), error handling, accessibility labels, and the tests.
- Whether the change-or-add question is a dialog or a small screen.

## Calls made after the builder check (My calls, found by reading the code; change them if wrong)

- **How Done saves.** Each field saves by its own request today (`useFieldSave`, one `PUT` per field, `flush()` per field; the About screen already flushes typed tags this way). Done flushes every field on the screen and waits for all of them. If any one fails, the error shows, "Saved" does not, and the person stays. "The server accepted it" means every flush succeeded.
- **Where "next screen" comes from.** After the saves, reload the profile (and documents) from the server and compute the next open item from that fresh answer, never from the cached copy, so a screen just finished is never offered again.
- **Where the "missing" check lives.** Both: the screen blocks Done and names the empty required fields it already marks with a star (`lib/compulsory.ts`); after the save the server's `missing` list stays the source of truth for what is next.
- **Several services.** The checklist needs at least one. Done on a new or edited service saves it and goes to the next open item (no loop over services).
- **"Change or add something: yes".** Goes to My business. A later Done on a complete screen is an edit (Saved and back, see above), so the prompt does not come back by itself; the provider flips the Publish switch at the top of My business when ready. (This replaces my first idea of re-running the prompt.)
- **Documents and payouts.** The server's `missing` list holds profile fields only (`packages/contract/src/my-profile.ts`). A never-uploaded photo ID and the payout set-up are not in it (they are in the app's second list, which never blocks the Publish switch, `lib/live-checklist.ts`). The owner decided they are part of this flow anyway (see "Which screen is next"); the Publish switch itself stays as it is.

## Decided since the builder check (**Owner**)

1. A provider is sent to upload the photo ID and set up payouts first, before the "change or add something" question.
2. Done on an already-complete screen: just "Saved" and back to where the person was.
