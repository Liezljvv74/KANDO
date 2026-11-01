# AI check of uploaded documents - plan (MVP plan step 0.2)

Status: decisions agreed by the owner on 1 November 2026. Build starts in phase 2 (steps 2.1 to 2.6 of the MVP plan).

## What it does
When a provider uploads a verification document (photo ID, insurance, trade registration, craft qualification), a server job asks an AI model to read it and return a suggestion: document type, name matches the account, not expired, flags. The suggestion is stored; the document is approved or sent to a person according to the rule below. A failing provider never blocks an upload.

## Owner decisions
| Question | Decision |
|---|---|
| Model provider | An OpenRouter model. Chosen by a comparison on about 20 made-up documents, with a cost cap. EU data, processing agreement, "no training, no retention" setting and DPIA are signed off first (step 2.1, owner). |
| Which documents | All, including photo ID. |
| Automatic decisions | Allowed. A human checks only in the cases below. |
| Human check, photo ID | Only an ID where the AI found a problem (for example the name does not agree), plus a 10% random spot check of the other IDs. |
| Human check, other documents | The AI found a problem, or its confidence is low, plus a 10% random spot check. (Same idea as for ID; the owner can adjust.) |
| ID photo retention | Deleted 30 days after the check is finished. Also deleted with the account. |
| What the AI may store | Only the verdict and, when a person must step in, an explanation of why the AI did not approve. Nothing read from the document: no ID number, birth date or address. |
| AI quote assistant | Owner likes it; to be discussed when this plan is built (reminder open). |

## Protecting the ID photo
1. Private storage; only the account owner and staff, through short-lived signed links.
2. The image goes to the model once, for the check, with the provider's no-training and no-retention setting; it is not sent again.
3. Only the verdict and the "why not approved" text are stored. Document content is never stored from the model's answer.
4. Nothing from the ID is written to logs or error reports; only the document id and the verdict.
5. Deleted 30 days after the check, and with the account; the deletion spec proves it (step 2.5).
6. Automatic approval of an ID is allowed only when the AI found no problem; the random 10% sample is drawn after that decision and can reverse it.

## Steps (from the MVP plan)
- 2.1 Provider, processing agreement, DPIA, API key in Vercel (owner).
- 2.2 Backend: results table with row-level security (verdict and reason only), job after upload, call through OpenRouter, rate limits and cost cap, 10% sample, 30-day deletion sweep, tests including a failing provider.
- 2.3 Back office: suggestion panel next to each document; staff decide; decision logged.
- 2.4 Disclosure (German and English labels, privacy text names the provider, Article 50 note).
- 2.5 Delete my data and export cover the AI result.
- 2.6 Evaluation on about 20 made-up documents, result recorded in `Reports/`.

## Open for the owner
- The cost cap per month (amount) and the model shortlist, at step 2.1.
- Whether other documents use the same 10% rate as ID.
