# Providers from 16, and filling in the sign-up from the ID card

Status: plan only, nothing built. Owner decisions of 4 November 2026: (1) option 1 for young people: customers stay 18 or older, providers may be 16 or older with a parent or guardian's consent; the owner confirms the law with lawyers before going live. (2) Idea: the first step of registering could be a scan of the ID card, which fills in name, date of birth and the rest; typing everything in by hand stays possible for changes and for people who do not need to upload an ID.

Where it fits in the MVP plan: not needed for the capstone. After the assessment and before launch; suggested steps 6.1 (providers from 16) and 6.2 (ID scan fills in the sign-up), size L and M. The owner confirms the numbers before the Plan sheet is changed (the tracker changes wait for the open tracker PR).

## Part 1: providers from 16 with a guardian's consent (step 6.1)

Rules
- A customer must be 18 or older (the sign-up tick stays as it is).
- A provider must be 16 or older. Under 18, the services cannot be published until a parent or guardian has consented; at 18 the consent is no longer needed.
- The age is never shown on a public profile.

Design (to confirm after the lawyer)
1. **Date of birth.** Asked only when someone switches on "I also want to offer services" (customers are not asked). It comes from the ID scan (part 2) or is typed in. Stored as `users.birth_date` (a date, row-level security private, included in the export and removed with the account). Compared with the date on the ID by the document check; a difference goes to staff.
2. **Guardian consent.** A provider under 18 enters a guardian's name and email. The guardian gets an email with a link, reads a short text (German and English) and confirms; the time, the guardian's name and email and the version of the consent text are stored (`guardian_consents`: new table, private to the person and staff, with an isolation test and classification in `rls.ts`). Consent can be withdrawn by the guardian at any time through a link in later emails; withdrawing unpublishes the services. A new email text needs push, email and in-app versions only if it is a notice to a person with an account; the guardian has none, so email only.
3. **Payouts.** Stripe pays out only to an adult account holder (to be verified with Stripe). A provider under 18 gets paid through a payout account that belongs to the guardian: the guardian completes Stripe's hosted form. The payout screen explains this in plain language. If Stripe or the lawyer does not allow it, under-18 providers cannot take paid bookings and the feature stays off.
4. **Turning 18.** The consent flag stops mattering on the 18th birthday; the payout account must then be the person's own (a prompt, and payouts pause until done).
5. **Invoices and tax.** Whose name is on the invoice or receipt for a minor's job, and whether a trade registration or the family court's approval is needed (§ 112 BGB) is for the lawyer and tax adviser.
6. **Terms and privacy.** Reword the age sections; add the guardian-consent text and a section on children's data (privacy). The DPIA covers date of birth and guardian data.
7. **Tests.** Contract and domain specs for the age rule (16 or 17 without consent cannot publish; with consent can; withdrawn consent unpublishes; 18th birthday), isolation test for the new table, export and account deletion cover it, notification parity unaffected.

Questions for the lawyer (also added to the README list)
- May a 16 or 17 year old offer small services and agree prices, and is a parent's consent in the app enough (§§ 106 to 113 BGB)?
- Is the family court's approval needed for independent business (§ 112 BGB), and is a trade registration needed?
- Does the youth employment law apply to self-employed jobs such as babysitting and dog walking?
- May payouts for a minor's work go to the guardian's Stripe account, and how must the invoice or receipt read?
- What must the privacy policy say about children's data (consent from age 16 under GDPR Article 8 in Germany)?

## Part 2: ID scan fills in the sign-up (step 6.2)

The idea is good: the ID card has the name, date of birth, expiry date and (on the back) the address, and a provider already has to upload an ID for the document check. One upload could serve both.

Where it goes: **not as the very first step before the account exists, but at the start of provider setup, after the email is confirmed and the terms are accepted.** Reasons:
- Before the account exists there is no accepted terms and no privacy notice, so there is no basis to send an ID to an AI service.
- A scan before login would be an open endpoint that calls a paid AI model; anyone could run up the monthly cap.
- A customer needs no ID, so most people should never be asked (data minimisation).

How it works
1. In the "Offer services" setup (and on the sign-up screen after the code is confirmed, when that switch is on) the first option is "Scan your ID card to fill in your details"; "Enter by hand" is next to it and always works.
2. The photo is uploaded as the person's ID document (the same private storage and rules as today, deleted 30 days after the check and with the account). The server reads name, date of birth, expiry date and address and returns them as suggestions; the person sees them, changes anything and confirms. Nothing is saved before the confirmation.
3. The same upload counts as the ID document for the check, so the person uploads once.
4. If the reading is unsure or fails, the form stays empty and the person types in the details.

Choices and risks
- **Server or on the phone?** Reuse the existing OpenRouter pipeline (a new prompt and result shape; fastest to build; the ID leaves the phone, which the DPIA already covers) or read it on the phone (no data leaves the device; needs a native text-recognition module and a new development build; less accurate). Recommended for the first version: server side through the existing pipeline.
- **What we store changes.** Today the terms (section 5a) and the privacy text say we do not store birth dates or addresses read from a document. With this feature the date of birth is stored (needed for the age rule) and the address may be saved as the person's address. The terms, the privacy policy, the DPIA and `docs/article-50-note.md` must be reworded, and the AI result still never keeps ID numbers.
- **Cost and abuse.** The scan needs an account, a rate limit (the existing limit of 10 AI checks per hour applies) and counts towards the monthly cap.
- **Correctness.** A misread date could wrongly mark someone under 18. The person confirms every value and the document check compares it with the ID, so a difference goes to staff.

Tests: domain spec for the extraction result shape and for "nothing saved before confirmation"; the AI-check rules for date of birth; mobile tests for the confirm and manual paths. Evaluate on the same kind of made-up ID cards as step 2.6 (never real ones) and record the result.

## Order of work

1. The lawyer answers (owner); in parallel the DPIA update.
2. Step 6.2 first if the owner wants the nicer sign-up sooner: it does not depend on the age rule and helps every provider.
3. Step 6.1: migration, table with row-level security, consent flow, payout rule, texts. Go live only after the lawyer and Stripe confirm.
