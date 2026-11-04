# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Users

Two audiences of equal weight (owner decision, 5 November 2026); neither is an afterthought.

- **Customers: households in Germany** who need a small job done by someone nearby (cleaning, gardening, dog walking, window and car washing and similar). They are not professionals at hiring; they want to see who is checked, what it costs and when it happens, and to pay without hassle. Customers are 18 or older.
- **Providers: local helpers and small businesses**, including young helpers from 16 with guardian consent (planned, option 1, pending a lawyer's check). They set up a profile with services and prices, upload verification documents, answer requests with quotes and get paid when the job is done.

Languages: German (the main language) and English. Every user-facing text exists in both. South Africa is a planned second market, so no new Germany-only assumptions.

## Product Purpose

KANDO is a service marketplace for Germany. A customer sends one request (what, where, date and time), providers answer with quotes, the customer confirms one, pays through Stripe (test mode for now), and the money is released when the job is done. Invoices and receipts are included. Success: a household can go from "I need help" to a paid, finished and reviewed job entirely in the app, and a provider can go from sign-up to a first paid job without outside help.

## Positioning

Providers' documents are checked before their profile can be published (an AI model reads the uploaded document and only ever approves when sure; staff decide every other case, with a spot-check sample), so "checked helper" is a fact shown on the profile and not a claim. Payment, quotes, invoices and the chat live in one place. A neighbouring job board without document checks and held payments could not truthfully say this.

## Operating Context

- The phone app (Expo, SDK 58, expo-router) is the working surface for both sides: Home, Search, My profile (providers only), Account, plus request, quote, booking, chat and invoice screens opened from notices.
- The website and the staff back office (German and English) run on the same server at https://skillweb.space; staff decide documents, disputes and suspensions there.
- Sign-up needs an email confirmed with a code and a tick for the Terms and Privacy Policy (the AI use is disclosed there); a provider can publish a service only after an approved ID document.
- The phone is tested on Android builds (EAS preview); the owner walks the flows on her own phone.

## Capabilities and Constraints

- Built: sign-up and login, search by category and postcode, public provider pages, provider profile setup, verification documents with AI check, request, quote, confirm, payment, booking endings (finish, cancel, no-show, dispute), reviews, chat with contact-detail filter, notices (push, email, in-app), invoices, export and deletion of own data, ID scan that fills in account details, terms re-acceptance (in progress).
- Rules that shape the interface: money is held and released only when the job is done; cancellation and no-show rules are fixed (commission 12 percent paid by the provider; customer late cancellation pays 50 percent; provider cancellation costs nobody anything); the street of a customer stays hidden until the booking is accepted and paid.
- Errors must name the problem and the action needed to continue; no generic "something went wrong" where the cause is known.
- Undecided: whether the product name stays KANDO next to the web address skillweb.space; consumer withdrawal wording (to be advised); the legal pages are unpublished drafts with [brackets] to fill.

## Brand Commitments

- Product name in the app: KANDO (owner decision, 5 November 2026). The company behind it is Amplivine, Wustermark, Germany.
- No competitor names anywhere in the product or its documents.
- Voice in the app: second person singular informal in German ("du"), plain and direct in both languages.
- Existing visuals are placeholders: app icon, splash and home pictures are not final.

## Evidence on Hand

- Live site with Stripe test payments: https://skillweb.space.
- Test reports in `Reports/` (latest `Flow-1-Test-Report.xlsx`: web 941 passed, mobile 344), an AI evaluation (17 of 20 sample documents right, no problem document approved) in `Reports/ai-document-check-evaluation-2026-11-03*.md`, and an Article 50 note in `docs/article-50-note.md`.
- Not available and not to be invented: real customers, testimonials, reviews from real jobs, final logo or brand photography, any measured tap counts for the booking flow.

## Product Principles

1. **Trust is shown, not claimed.** Checked documents, held money and clear rules are visible where decisions are made.
2. **One path, few taps.** Every new job runs through one request form and one quote screen; nothing the person already told us is asked again.
3. **Both sides are first-class.** A provider's setup and a customer's request get the same care.
4. **Say what is wrong and what to do.** Every refusal names the problem and the next step, in German and English.
5. **Private by default.** Personal data (address, birth date, ID, documents) is shown only where needed and is always deletable.

## Accessibility & Inclusion

German and English with equal quality; screen-reader labels and a 44 px minimum touch target on interactive elements (applied to the sign-up terms checkbox, to be kept elsewhere); the app must work on a phone in poor light and with a slow connection (retry states exist). No product-specific standard beyond that has been set.
