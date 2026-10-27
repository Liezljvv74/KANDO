# Registration and one-page provider setup

Date: 27 October 2026. Status: draft for the owner's approval. Follows the foundation design (`2026-10-26-kando-foundation-design.md`) and changes the sign-up and the provider profile screens of the SkillWeb app, plus the data behind them.

## Why

The Stage 1 app inherited the old flow: sign up, then on "My profile" fill a first form, save, and only then discover the + buttons for photo, services, references, documents. The owner found it on the first phone check (27 October): "I see nowhere to upload a photo, I cannot select a category anywhere." The old layout also keeps a separate "display name" and provider photo that duplicate what the account already knows.

The new flow asks at sign-up whether the person offers services, collects what a customer needs once, and puts the whole provider setup on one page that saves as you type and publishes with one button.

## Goals

- A customer registers in one go: name, email, password, optional profile picture, optional address.
- A provider sees one page with everything needed and nothing twice.
- Nothing typed is lost if the app closes: every field saves as it is entered.
- "Publish" is only active when the profile is complete; pressing it makes the profile live and offers sharing.
- Services whose document is still being checked wait without blocking the rest.
- The person is told, in the app and by email, when a checked service goes live, with the share link at hand.

## Non-goals

- Push notifications (need a native module and a new build; they come with bookings and chat).
- Sign-up or profile editing on the website (app only, as today).
- Payment details, bookings, ratings (later stages).
- Any country-specific behaviour: the address carries a country, the postcode check is per country, nothing else changes.

## Anti-goals

- Asking for the same fact twice (name, postcode, photo) on two screens.
- A long form that must be completed in one sitting.
- A provider going live with a hidden listing and no message why.

## Constraints

- Country-ready rule (README): address with a country, open-ended languages, no `=== 'en' ? … : …` switches.
- Row-level security as in Stage 1: owner-only on private data; the address is private.
- No new native modules in the app: sharing uses React Native's built-in share sheet; photos and documents use the pickers already installed. No new development build is needed.
- Every text in both languages in `packages/i18n`.
- No AI co-author lines in commits; owner merges PRs; test report after the work (`Reports/`).

## The decisions

### 1. Sign-up

Fields, in this order: first name, surname, email, password (as today, 8 characters), profile picture (optional: take a picture or choose from the gallery, with one line under it on why it matters: providers see who they are working for, which keeps both sides safer), tick box "I also want to offer services" (off by default), address (optional; one block: street and number, postcode, city; country fixed to Germany for now and stored). Email confirmation by code stays as it is.

After the code is confirmed:
- tick off: the Home tab.
- tick on: the provider page with the headline "Let's set up your service profile".

The tick only decides where the person lands. Anyone can open the provider page later from the Account tab ("Offer services"); a provider is always a customer too.

The profile picture is the person's picture: it serves customers (a provider recognises who booked, a safety point) and providers (it is the picture on the public page). One picture, stored once. For customers it is optional (owner decision, 27 October): the app nudges, it never blocks. While the picture is missing, Home shows a dismissible banner "Add your picture" with the safety reason, and the banner returns at the moment it matters most, before the first booking request in the bookings stage. For providers the picture stays compulsory for Publish.

The address is private. It is used for the default postcode in search and, in later stages, shown to a provider only after they accepted a job that needs it. If the address is missing, the app asks for it when it is first needed (a search without a postcode, later a booking at the customer's place) and saves it to the account from there.

### 2. The provider page

One screen, "My service profile", made of cards in this order. Each card holds one kind of record, so nothing is entered twice and each card can carry its own "still missing" mark.

1. **Header**: the account picture with a pencil (changing it here changes the account picture), the name as customers will see it (derived, see 4), and the status: Draft, Live, or Live with services waiting for a check.
2. **Services**: one block per service: category (dropdown, compulsory), title (if left empty it is filled with the category name on save), description, price type, price. "Add another service" at the bottom of the card. Each block has a "Remove" link. A service whose document is not yet approved shows "waiting for the document check" in its block, as today.
3. **About you**: individual or business (a business adds business name and legal notice text), about you (optional), strengths, skills (tags, compulsory, at least one), experience (compulsory), postcode (prefilled from the address once, when the draft is created; editable here at any time, for a provider who works from somewhere else or moves to a new area), service radius, "also works remotely".
4. **Past jobs**: unchanged (card with +, up to the current limit).
5. **Portfolio**: unchanged (card with +).
6. **Documents**: shown only when at least one service's category requires a document. Red-shaded. Text: "The service you provide requires verification documentation. Please add the following documents:" then one line per required document across all services (two categories that need the same certificate produce one line), each with its status (needed, waiting for check, approved, rejected with the staff note) and an "Add" button offering upload file, choose from gallery, take picture (the three options the app has today).
7. **Publish** button, fixed at the bottom. Greyed out until the profile is complete; its label explains why when pressed in the grey state ("Still missing: …"). When the profile is live the button area shows "Live" and a "Take offline" link (today's Live switch, kept for taking a profile offline only).

**Saving.** The draft profile row is created the moment the page opens for the first time, so every card is on screen from the start. Each text field saves when the user leaves it (one request per field change, debounced); dropdowns and switches save on change. Photos and documents upload when picked. There is no separate Save.

**Complete means**: profile picture; at least one service with a category and a price type; provider type, and for a business the business name and legal notice; at least one skill; experience; postcode; service radius. Everything else is optional. The server decides (`missing` list on the profile), the app mirrors it for the button.

**Publish** calls the existing publish; the profile goes live. Services with an unapproved required document stay hidden until approved, as today; all other services are visible at once. The message after publishing:

- nothing pending: "Your profile is live. Tell people about it." with a **Share** button;
- something pending: "Your profile is live. Your [category] service goes live once we have checked your document." without Share.

**Share** opens the phone's share sheet (WhatsApp, Instagram, email, copy link, whatever the phone has) with a short text in the provider's language and the link to the public page on the website.

Editing after going live uses the same page; changes apply immediately, as today.

### 3. When a checked service goes live

When a staff approval makes the last hidden service of a published provider visible, two things happen after the approval is saved:

- an email "Your profile is live" with the link to the public page and the invitation to share it (template alongside the existing approval and rejection emails);
- an in-app notification: a banner at the top of My service profile, "Your profile is live. Tell people about it." with the Share button, shown until dismissed, and a dot on the Account tab until seen.

Rejections keep today's email with the staff note; the Documents card shows the note and the Add button again.

**Every email says what actually happened.** The wording follows the real state of the profile at that moment (owner decision, 27 October):

| Event | Email to the provider |
| --- | --- |
| Document approved, profile live, nothing else pending | "Your document is approved and your profile is live." with the public link and the invitation to share. |
| Document approved, profile live, other documents still pending | "Your document is approved. Your [category] service is now visible." |
| Document approved, profile offline (taken offline by the provider) | "Your document is approved. Your profile is offline at the moment; the service becomes visible as soon as you publish again." |
| Document approved, profile suspended | "Your document is approved. Your profile is suspended until [date]; the service becomes visible when the suspension ends." |
| Document rejected | Today's email with the staff note and what to upload again. |
| Staff suspend the profile | "Your profile was suspended for [reason]. It will be published again on [date]." (the date chosen by staff) |
| Suspension ends, by date or lifted by staff | "Your profile has been published again and customers can book your services again. Good and prompt service rewards you with more customers." |
| Staff warning (no-show) | "You received a warning: [reason]. A second warning suspends your profile for 30 days." (text per the foundation design) |

For this to be true, **a suspension ends by itself at its end date** (my call, replacing the Stage 1 rule "until staff lift it"): search, the public page and publishing treat an expired suspension as over, staff can still lift early, and the "lift pending" state in the back office disappears. The "published again" email is sent when the date passes (a daily check) or when staff lift it. All texts in both languages.

Notifications are stored in a small table (user, kind, created, seen, payload with the link), so later kinds (booking requests, messages) reuse it. Push delivery is added in the bookings stage.

### 4. Data changes

- `users`: `first_name`, `last_name` replace `name`; `photo_id` (the person's picture) moves here from `providers`; `address_street`, `address_postcode`, `address_city`, `address_country` (all nullable, private: owner-only under RLS, staff see them in the back office user page).
- `providers`: `display_name` and `photo_id` are dropped. The public name is derived once more: "First L." for individuals, the business name for businesses. Public pages, search cards and photos read the picture from the owner.
- `notifications`: `id`, `user_id`, `kind`, `payload` (json), `created_at`, `seen_at`. Owner-only under RLS; written by the server after commit.
- `users.is_provider` becomes true when the tick is set or the provider page is opened.
- Nobody uses the app yet, so the migration may rebuild these columns without preserving data; the seeds are updated to the new shape (first and last names, picture on the user).

### 5. What stays as it is

Search, eligibility rules (`offerable_service_ids`, `missing_requirements`), the public provider page and website, the back office (the user page gains the address and the picture), the translate button, the Live/offline rule, the limits on services, references and photos.

### 6. Texts

New texts in German and English: the sign-up tick, the address labels, "Let's set up your service profile", the Publish states and messages, the Documents card text, the share text ("Find me on SkillWeb: [link]"), the profile-live email and banner. Product name through the one existing setting.

## Left to the builder

- Exact debounce timing and the error shown when an autosave fails (the field keeps its value and shows a retry; nothing silently reverts).
- Card layout details, spacing and icons, matching the existing My profile style.
- How the Account tab dot is cleared (opening the profile page counts as seen).
- The share text wording beyond the German and English line above.

## Owner decisions recorded in this document (27 October 2026)

- Tick box at sign-up decides the landing page only.
- Customer sign-up: first name, surname, email, address (optional, private, postcode drives search), profile picture optional with a nudge that explains the safety value; compulsory only for providers at Publish.
- Provider page order: services (category compulsory, title auto-filled), about you, past jobs, portfolio, documents at the end in a red card.
- Everything saves as entered; Publish instead of Save, active only when complete.
- Compulsory for Publish: picture, one service with category and price type, provider type (+ business name and legal notice), skills, experience, postcode, radius.
- A provider goes live with complete services while a pending one waits; no Share while something is pending; the share link comes with the "profile is live" notification in the app and by email.

## Builder questions, settled (my calls, strike any that are wrong)

1. **Where the picture lives.** The `photos` table gets a nullable `provider_id` and a `kind` of `avatar`; `users.photo_id` points at the avatar. A customer's picture is readable by its owner (and staff) only; it becomes publicly readable through a live provider profile, by the same rule that makes provider photos public today. The picture is chosen on the sign-up form and uploaded right after the code is confirmed (the first moment the app has a session). If the app closes in between, the next launch continues at the picture step before anything else (see the owner question below).
2. **First and last name.** The app sends both to the server right after confirmation (the existing `PATCH /me` grows `firstName` and `lastName`; `name` disappears from it). Neon Auth keeps its own single name ("First Last") for its records only; the server never splits it. Both names are editable on the Account tab.
3. **Picture missing.** Not a server rule for customers: `GET /me` reports whether a picture exists and the app nudges (banner on Home with the safety reason, dismissible, back before the first booking). The picture chosen on the sign-up form is uploaded right after the code is confirmed; if the app closes in between, the nudge covers it. Seeded provider accounts get a placeholder picture (the existing generator); seeded customers none.
4. **Draft row.** `providers.type` becomes nullable and `display_name` is dropped, so the row can exist empty; `POST /provider-profile` creates the draft when the page opens (also right after confirmation when the tick was set); a second call returns the existing row. Drafts accept partial saves; the rules "business needs a name and legal notice", "at least one skill" and so on are checked at Publish, not while typing.
5. **Going-live trigger.** When an approval is the last one that keeps a service of a published, non-suspended provider hidden, the approval email is replaced by one "Your document is approved and your profile is live" email with the link, and the in-app notification is created. Otherwise the plain approval email goes as today. Unpublished or suspended providers get the plain approval email only.
6. **Publish with only a pending service.** Allowed: the profile is live, the message says the service goes live after the check, and the public page stays hidden until one service is visible (today's rule). No Share until then.
7. **Display name consumers.** Search cards, the public page and the back office show the derived public name; the translate button translates service titles, descriptions, about you and strengths, no longer a display name. The slug comes from the public name; since the first name is compulsory, the empty case cannot occur for new accounts.
8. **Per-field saves.** Services use the existing per-service create, update and delete; the profile fields use the existing partial `PUT` (one field per request). A failed save keeps the value on screen with a retry mark.
9. **Notifications.** `kind` is a check constraint (`profile-live` for now); `seen_at` clears the Account dot (set when the profile page opens), `dismissed_at` hides the banner.
10. **Share link.** The site's public address setting (`NEXT_PUBLIC_SERVER_URL`, else the Vercel address) plus `/providers/<slug>`, with `?lang=en` for English providers; the same link goes into the email.

## My calls (strike any that are wrong)

- Provider type sits once in About you, not after each service's price.
- Postcode on the provider page is its own field, prefilled from the address once, editable any time (a move is the normal reason).
- A suspension ends by itself at its end date, so the suspension email can promise the date; staff can lift earlier.
- Title auto-fill uses the category name in the provider's language at the time of saving.
- Taking a profile offline keeps the existing control; Publish is only for going live.
- Notifications get their own table now, so the bookings stage reuses it.
