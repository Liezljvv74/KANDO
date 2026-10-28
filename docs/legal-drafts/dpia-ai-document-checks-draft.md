# Data protection impact assessment (DPIA): AI-assisted document checks

Status: DRAFT of 28 October 2026 for the owner and a lawyer or data protection adviser to review. Not legal advice. Things in [square brackets] are missing information or decisions. The assessment must be finished and signed off BEFORE any real document is sent to an AI provider.

Controller: Amplivine, [address], Germany. Contact: info@skillweb.space. Person responsible: Liezl Fourie.

## 1. Description of the processing

**What it is.** Providers on SkillWeb upload documents that prove who they are and that they may offer a service (see `docs/required-documents-draft.md`). Staff check each document and approve or reject it. The planned change: after upload, an AI vision model reads the document and returns a fixed set of fields. Owner decision of 28 October 2026: the AI handles about 90% of the checks; a person looks only when needed (see section 1a). The AI may approve a document by itself when every check passes. It never rejects by itself: anything doubtful goes to a staff member (owner confirmed, 28 October: no automatic rejection, about 10% sample audit, first approvals by a person).

**Purposes.**
1. Verify that a provider is who they say they are and holds the documents their services need (trust and safety of customers; know-your-trader record for the EU Digital Services Act).
2. Make the human check faster and more consistent (fewer slips, same standard for every provider).

**Data subjects.** Providers who submit documents (private persons and sole traders). Not customers. Possibly third parties named in documents (for example an employer on a certificate).

**Data processed.**

| Document | Personal data in it | Category |
| --- | --- | --- |
| Photo ID (front and back) | Name, date of birth, place of birth, nationality, document number, photo, address (ID card back), machine-readable zone | Ordinary personal data. The photo is not used for face recognition or any biometric matching |
| Police certificate (Führungszeugnis) | Name, date of birth, address, "no entries" or a list of convictions | Data about criminal convictions (Art. 10 GDPR). Highest sensitivity |
| Trade registration, freelance proof | Name, address, business activity, date | Ordinary |
| Liability insurance proof | Name, address, policy number, cover and period | Ordinary |
| Hygiene certificate, food business registration, permits, craft qualification | Name, issuing authority, dates | Ordinary |

**What the AI returns (the only data kept from the AI step).** Document type; name on the document; issuer; issue date and expiry; whether the name matches the profile; for a police certificate ONLY: issue date and whether it states "no entries" (yes/no); for an ID ONLY: document type, name, expiry date and whether it is readable. Plus flags (for example "text layer disagrees with the image", "possible edited document") and a confidence value. Full text, date of birth, address, document number, the photo and any conviction details are NOT requested and NOT stored.

**Flow.**
1. The provider uploads the document in the app (existing step; image or PDF into the private storage bucket in the EU).
2. A background job sends the file to the AI provider over an encrypted connection with a fixed instruction and an output format. The AI has no tools and no internet access.
3. The answer is checked against the fixed format; anything else is thrown away. The fields are stored next to the document as advisory data.
4. If all checks pass with high confidence and the document type allows it (section 1a), the document is approved automatically and the decision is logged with the fields. Otherwise it goes to the staff queue: a staff member sees the document and the checklist and decides. Every rejection is a staff decision.
5. The advisory fields are deleted with the document.

**Recipients.** The AI provider [to be chosen, as processor, EU servers]; staff of Amplivine with the reviewer or administrator role; hosting and storage providers already used (Vercel, Neon).

**Retention.** The document itself: while the account exists, and 6 months after account deletion as a know-your-trader record (owner decision of 28 October, legal confirmation pending). The AI output: deleted together with the document. At the AI provider: no storage of the document or the answer after the request ([to be confirmed in the contract: zero data retention, no use for training]).

**Technology.** Vision model called by a server-side background job. Documents stay in private storage; the job reads them with a short-lived access link. No document is sent from the phone to the AI provider directly.

## 1a. Operating model: AI first, a person when needed

| Situation | Who decides |
| --- | --- |
| All checks pass, confidence above the set threshold, document type allows automatic approval | AI approves; logged; counts towards the sample audit |
| Any check fails, low confidence, a flag (edited, text layer disagrees), unreadable, expired, name does not match | Staff queue; staff decide |
| AI wants to reject | Never automatic: staff queue, and the provider gets a human-written reason |
| Police certificate showing anything other than "no entries"; extended certificate for Babysitting | Always staff, no automatic approval |
| Provider's first documents (first [50] approvals) and any provider with an earlier rejection or complaint | Staff until trust is established (owner confirmed, 28 October) |
| Random sample of automatic approvals (about 10%, owner confirmed, 28 October) | Staff re-check afterwards; wrong approvals are withdrawn |

Target: about 90% of documents decided without a person. The share is measured monthly; the thresholds are tuned on the [300]-document test before launch and may be stricter at first. Photo ID: automatic approval only for the checks listed (type, name match, not expired, readable); no biometric face comparison.

## 2. Necessity and proportionality

- **Lawful basis.** Providers' contract with SkillWeb (Art. 6(1)(b)) for the checks needed to offer services; legal duty where it applies (Art. 6(1)(c), know-your-trader under the Digital Services Act, if it applies to Amplivine); legitimate interest in trust and safety (Art. 6(1)(f)). For the police certificate the processing relates to criminal-conviction data (Art. 10): it is allowed only as authorised by law. [Lawyer to confirm the basis under German law; the provider asks for the certificate for the specific purpose of working with children or in homes.] The provider is told before upload.
- **Is it necessary?** The human check already happens. The AI step is not strictly necessary, but it improves the quality of the check and reduces how long staff look at sensitive documents. If a lawyer decides the AI step for police certificates or ID copies is disproportionate, those two document types are excluded from the AI step and stay manual (the design allows excluding a document type with one setting).
- **Data minimisation.** The AI is told to return only the fields listed above; the answer is validated; nothing else is stored. Only the specific document is sent, never the whole profile.
- **Automated decisions (Art. 22).** Automatic approval is a decision based solely on automated processing. Approving is favourable to the provider, and the risk is lower than for a refusal, but a document check decides whether a person may offer services, so safeguards apply: no automatic rejection; a human always decides doubtful cases; the provider can ask for a person to review any decision and can resubmit; the logic and thresholds are described in the privacy policy; monthly sample audits; automatic approval can be switched off per document type with one setting. Criminal-conviction data (police certificate) is never decided automatically in the adverse direction, and the extended certificate for child care is always checked by a person. [Lawyer to confirm that this model is lawful under Art. 22(2) and German law; if not, the AI step falls back to advice only.]
- **Transparency.** The privacy policy states that documents may be read by an AI service as an aid, names the provider category and region, and states that a person decides. The upload screen says so as well. [Wording to be added once the provider is chosen.]
- **Rights.** Providers can ask for access, correction and deletion (account deletion exists in the app), can object, and can ask for a human to review again; every decision is already a human decision.

## 3. Risks to the people concerned, and measures

Likelihood and severity: low / medium / high, before and after the measures.

| # | Risk | Before | Measures | After |
| --- | --- | --- | --- | --- |
| 1 | Sensitive documents (ID copies, police certificates with possible convictions) leak at the AI provider | Severity high, likelihood medium | Provider with EU servers, data-processing agreement, zero retention, no training, confirmed sub-processors and security certification (for example ISO 27001); only the needed document is sent; encrypted transfer; the AI answer holds no conviction details or ID number | Severity high, likelihood low |
| 2 | Transfer to a country without adequate protection | High / medium | EU region only; no routing through general aggregators that can choose other regions; written confirmation of data location; standard contractual clauses if any sub-processor is outside the EU | Low |
| 3 | The provider uses documents to train models | High / medium | Contract term and technical setting: no training, no retention; verify yearly | Low |
| 4 | Wrong AI result causes a wrongful rejection or approval (hallucinated date, misread name) | Medium / medium | Staff always decide and look at the document; AI shows confidence and flags; track agreement between AI and staff on a sample of [300] documents before relying on it; rejected providers get a human-written reason and can resubmit | Low |
| 5 | Wrong automatic approvals (forged, expired or someone else's document accepted) and staff who rubber-stamp the AI queue | High / medium | Strict thresholds; sensitive types always human; sample audit of about 10% of automatic approvals; withdrawal of wrong approvals; reviewer must open the document before the buttons work; approval rate and error rate reported monthly | Medium (accepted) |
| 6 | Prompt injection: text hidden in an uploaded PDF tells the AI to approve or to reveal data | Medium / medium | The AI has no tools or access to other data; fixed instruction and output format; answers outside the format are discarded; the AI answer never changes the status | Low |
| 7 | Forged documents are not detected | Medium / medium | The AI is not treated as a forgery detector; staff remain responsible; simple extra signals (PDF producer and edit history, text layer versus image) are shown as hints only | Medium (accepted) |
| 8 | Too much data kept (AI output, copies) | Medium / medium | Minimal fields only; AI output deleted with the document; no copies at the provider; retention defined | Low |
| 9 | Unauthorised access by staff | High / low | Roles (reviewer, admin), row-level security, staff actions logged, signed links valid 5 minutes, documents never public | Low |
| 10 | Criminal-conviction data processed without a legal basis | High / low | Basis confirmed by a lawyer before launch; the AI extracts only date and "no entries"; if the basis is not confirmed the certificate stays manual | Low |
| 11 | Bias: the AI reads some names or scripts worse than others, leading to more rejections for some people | Medium / medium | Humans decide; check the agreement rate by name origin on the sample; a failed AI read never leads to rejection by itself | Low |
| 12 | Providers do not understand what happens to their documents | Medium / medium | Clear notice at upload and in the privacy policy; contact address | Low |

## 4. Consultation

- Data protection officer: [not required below the legal thresholds; consult a data protection adviser or lawyer instead].
- Affected people: [consider a short test with 3 to 5 providers before launch].
- Supervisory authority: prior consultation (Art. 36) is needed only if high risk remains after the measures. [Adviser to confirm; expected: not needed.]

## 5. Conclusion and review

Expected result: the processing is acceptable with the measures above, a human deciding every rejection and every doubtful case, and a provider that meets the conditions in section 3. If any of these cannot be met (EU servers, zero retention and no training, a data-processing agreement, lawyer confirmation for criminal-conviction data), the AI step is NOT started for the affected document types.

- Decision and date: [owner and adviser sign-off].
- Review: after the first [300] documents, then yearly, and whenever the provider, the document types or the purpose change.

## 6. Before the first real document goes to an AI provider

1. Provider chosen and compared in writing (data location, retention, training, sub-processors, certification, price).
2. Data-processing agreement signed; list of sub-processors received.
3. Lawyer confirms the basis for criminal-conviction data and the know-your-trader duty.
4. Privacy policy and upload notice updated.
5. Test with sample documents (no real people) and measure agreement with staff.
6. This DPIA finished and signed.
