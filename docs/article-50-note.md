# EU AI Act Article 50 and AI disclosure: note for the assessor

Status: written 4 November 2026 (MVP plan step 2.4). A technical note, not legal advice; the points marked **[lawyer]** are for the lawyer or the DPIA review to confirm.

## What AI the app uses

| AI output | Who sees it | What the AI does | Disclosure | Human control |
|---|---|---|---|---|
| Translate button on provider pages | Anyone reading a provider profile | Translates the provider's own text between German and English through OpenRouter (server side only, rate limited) | Label on the text: "Automatically translated (AI) · Show original" (`provider.translatedLabel`, `web.translatedLabel`, German and English); the original is one tap away | The provider's original text is always kept and shown on request |
| AI check of verification documents | Staff only (back office panel "AI suggestion (an aid only, you decide)") | Reads an uploaded document and suggests type, name match, expiry date and problems; may approve automatically only when sure | The terms accepted at sign-up (section 5a) and the privacy policy (section 4a) describe it; by owner decision of 3 November 2026 nothing extra is shown on screen for the document check | The AI never rejects. Anything unsure, any problem, any outage goes to a person; a person also checks a 10% random sample of what the AI would approve |
| Reading an ID card to fill in the account details (optional, Account screen) | The person who scans their own card | Reads name, date of birth and address from one photo and suggests them; nothing is saved until the person confirms | Terms section 5b and privacy section 4c, accepted at sign-up; a short note above the button says what happens to the photo | The person checks and changes every value; typing by hand always works |
| AI quote assistant | - | Not built | If it is built, a small "AI-written" label stays wherever a person sees AI-written text | - |

## Article 50 duties, one by one

1. **Chatbots and systems that talk to people (Art. 50(1)).** The app has none. The only chat is person to person.
2. **Machine-readable marking and labelling of synthetic text, audio, image or video (Art. 50(2) and (4)).** The translation is AI-generated text shown to the public; it is labelled in the interface. The document check produces no content for the public. No images, audio or video are generated.
3. **Emotion recognition or biometric categorisation (Art. 50(3)).** Not used. The document check reads text and a photo on an ID to compare the name and expiry date; it does not identify or match faces.
4. **Deep fakes (Art. 50(4)).** None.

Risk tier: the document check supports a human decision about whether a provider may publish a profile. It does not decide access to work or essential services on its own (it never rejects) and it is not one of the Annex III use cases we know of. **[lawyer]** to confirm that tier, because providers' work access is close to the employment and self-employment category.

## Related duties that the AI document check triggers (GDPR, not Article 50)

- **Information (Art. 13 GDPR):** terms section 5a and privacy section 4a name the purpose, the processor category (an AI model service through OpenRouter, processed in the EU where available **[confirm with OpenRouter and the model provider]**), what is stored (only the verdict, the confidence and a short reason, never ID numbers, birth dates or addresses) and how long.
- **Automated decisions (Art. 22 GDPR):** only an approval can be automatic; a rejection is always a person's decision; a person can be asked to look again (info@skillweb.space). **[lawyer]** to confirm this is enough.
- **Sensitive data and retention:** photo ID images are deleted 30 days after the AI check and at once with the account; the AI result and cost records are in "Your data" (export) and are removed or anonymised on account deletion.
- **Processor settings:** requests are pinned to one provider (`google-vertex`) with `data_collection: deny`, `zdr: true`, no fallbacks. The app asks for no training and no retention; it cannot prove it, so the owner confirms it with the provider **[owner]**.
- **DPIA:** `docs/legal-drafts/dpia-ai-document-checks-draft.md`, owner sign-off pending. The DPIA review decides whether the small label on AI-written text can go.
- **Consent record:** a person cannot register without ticking the terms and privacy policy; the acceptance time is stored (`users.terms_accepted_at`) and the AI check skips accounts without it.

## Evidence in the repository

- Code: `packages/domain/src/ai/` (client, rules, document check), tests `ai-document-check.int.spec.ts`, `account-delete.int.spec.ts`.
- Measured result: 17 of 20 made-up documents classified right, no problem document approved (`Reports/ai-document-check-evaluation-2026-11-03*.md`).
- Texts: `docs/legal-drafts/ai-document-check-legal-text.md` (terms 5a, privacy 4a), published in the back office once the owner has filled the brackets.

## Open

- The terms and privacy pages are unpublished drafts, so the disclosure is not yet visible to people.
- Lawyer and DPIA points above.
