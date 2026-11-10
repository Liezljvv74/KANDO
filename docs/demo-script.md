# Demo script: KANDO / SkillWeb (6 minutes maximum)

Built around the evaluation criteria: **outcome** (it runs, live URL and phone, UI, README), **learning** (Claude Code workflow, RLS, deployment, CLAUDE.md, subagents and commands, a reviewed pull request), **security and compliance** (secrets, RLS on every table, security scan, AI disclosure, delete my data) and **presentation** (SCR and the six showcase points).

Live site: https://skillweb.space. Repository: github.com/Liezljvv74/KANDO. Payments are Stripe **test mode**; say so once, out loud.

## Timing at a glance

| Time | Part | Criterion |
| --- | --- | --- |
| 0:00 - 0:40 | Situation, Complication, Resolution | Presentation |
| 0:40 - 1:10 | The live site and the README | Outcome |
| 1:10 - 3:20 | Phone: request, quote, accept, pay, "Quote accepted" | Outcome, UI |
| 3:20 - 3:50 | Help, Feedback, German and English | Outcome, UI |
| 3:50 - 5:00 | Security and compliance | Security |
| 5:00 - 5:40 | How it was built with Claude Code | Learning |
| 5:40 - 6:00 | What's next | Presentation |

If you run long, cut in this order: Help and Feedback (3:20 - 3:50), then the website (0:40 - 1:10). Never cut the payment flow, the security part or the Claude Code part.

## Before you record (10 minutes, do it once)

- Install the newest Android build (EAS build of 10 November after #121; if it is not ready, build `5d1df1b6` works, it only lacks the last small fixes).
- Two signed-in accounts on production with demo data: a **customer** on the phone and a **provider** on a second device or a second browser tab of the app. Record the provider steps first or use a screen recording of them so you do not switch devices on camera.
- Have one **open request** ready (so the provider's quote takes seconds) and one more you create live.
- Card for the test payment: **4242 4242 4242 4242**, any future date, any CVC.
- Open in browser tabs: skillweb.space, the GitHub repo README, `packages/db/src/rls.ts`, `docs/audits/security-scan-2026-11-10.md`, `CLAUDE.md`, `.claude/README.md`, a merged pull request with your GitHub review (Approve) and the code-review comment.
- Do one dry run. The first payment on a fresh install is the step most likely to need a retry.

## The script

### 0:00 - 0:40 Situation, Complication, Resolution (slide or README top, talk to camera)

- **Situation:** In Germany many households need local help (small repairs, cleaning, gardening) and many solo providers want work.
- **Complication:** Finding someone trustworthy is hard: no checked documents, no clear price, money paid up front with no protection, no invoice.
- **Resolution:** KANDO is a marketplace app: providers upload documents that are checked, the customer pays through Stripe and the money is released only when the job is done, and invoices are included. A phone app plus website, back office and API on Vercel, data in Neon Postgres with row-level security.

Say: "Everything you see runs live, payments are in Stripe test mode."

### 0:40 - 1:10 Live site and README (outcome)

- Show https://skillweb.space loading (the public site). Say it is deployed on Vercel from the `main` branch.
- Switch to the GitHub README: purpose, how to run, status. One sentence: "The README says what is built, what is open, and how a new session resumes."

### 1:10 - 3:20 The phone flow (the core of the outcome and UI criteria)

Narrate each step in one short sentence.

1. **Search** (10 s): Search tab, find "Small repairs", open a provider: strengths, skills, "Checked documents", services. Point at the **one** "Request a quote" button per service.
2. **Request** (20 s): tap Request a quote, fill what, when, where, send. The job card appears under **Active jobs** with a bold **"Request sent"**.
3. **Provider answers** (25 s, recorded on the provider account): Jobs tab shows the request under **Needs you**; open it, send a quote (price, time, what is included).
4. **Customer accepts** (20 s): the customer sees "Your quote is ready", opens the quote (PDF too), taps **Accept quote**.
5. **Pay** (30 s): Stripe checkout with the test card 4242. Say: "The money is held by Stripe and released to the provider only when the job is done."
6. **Provider sees it** (20 s): provider's Jobs tab shows the **number on the Jobs label** and the card with the green **"😊 Quote accepted"** at the bottom right; the red **"New message"** appears in the same place when the customer writes in the chat. Open the job, then the number goes away.
7. **Finish** (only if time): provider taps Finish, the customer confirms, money released after the confirmation or automatically after 7 days; invoices are in Jobs, Invoices.

### 3:20 - 3:50 Help, Feedback, languages (UI quality)

- Open **Help** (button on every banner): 26 topics in six groups, written from what the code really does.
- Open **Feedback**, type one line, send: it goes by email to the team, the message is not stored.
- Switch the phone language German to English once to show both languages everywhere (German is the main language).

### 3:50 - 5:00 Security and compliance (about a quarter of the marks, give it full time)

Say each point and show it on screen:

1. **Secrets** (10 s): "No secret is in the repo or in the app; every Stripe, AI, storage and email call runs on the server. I searched the whole git history: no key was ever committed." Show `docs/audits/security-scan-2026-11-10.md`.
2. **Row-level security on every table** (25 s): open `packages/db/src/rls.ts`: every table is classified (private, published-read, staff-only, and so on), a test fails if one is not, and every private table has an isolation test. Say: "41 tables, all classified."
3. **Security scan** (15 s): "I ran the security scan with three scanners (Next.js, Vercel, row-level security) on 10 November: no critical or high findings; the medium ones are listed with a plan."
4. **AI disclosure, EU AI Act Article 50** (10 s): "The documents are checked by AI; all information about the AI used is in the terms accepted at sign-up; where a person sees AI-written text, a label shows." Show the terms page.
5. **Delete my data** (10 s): Account, Delete account: show the warning and what is deleted. Do **not** delete a real account on camera unless it is a throw-away one; say it removes the profile, files and login (the "delete my data" route, GDPR), with legally required records kept for 6 months for providers.

### 5:00 - 5:40 How it was built with Claude Code (learning)

- **CLAUDE.md** (10 s): the rules every session follows (the owner merges every pull request, tests, security, German and English texts).
- **Subagents, commands and skills** (15 s): `.claude/README.md` lists them: `/security-scan` (three scanner agents), `/test-report`, the RLS-check agent, the code reviewer.
- **A reviewed pull request** (15 s): open a merged PR: `/code-review` comment, the fixes, and your GitHub **Approve**. Say: "Nothing reached `main` without that."

### 5:40 - 6:00 What's next

- Reviews that stay visible after a provider or customer deletes their account.
- Rescheduling a confirmed booking (up to 36 hours before the time).
- Help search by meaning (built, waiting for its migration).
- Public website with provider pages and a download link; live payments after the lawyer review.

Close: "KANDO: trusted local help, paid safely, built and checked with Claude Code. Thank you."

## The six showcase points (for the 10 minute talk)

1. **The problem:** the SCR above.
2. **The solution:** the phone flow, the stack (Expo app, Next.js, Neon, Stripe, OpenRouter for the document check), and how Claude Code was directed (plans, subagents, reviews).
3. **The data:** users, providers, documents (private bucket), bookings and money; stored in Neon, protected by row-level security, files in a private bucket, deleted on request.
4. **Evaluation:** the test report of 10 November (`Reports/Test-Report-2026-11-10-main-after-PR114.xlsx`): web 1058 of 1062, mobile 424, domain 331, contract 48, i18n 18; typecheck and lint clean; the 4 web failures are 5 second time-outs under load that pass alone. Security scan: no critical or high.
5. **Challenges:** getting money, state and notices to agree (one derived job state), row-level security with server-side writes, and honest texts (a content audit of 192 claims against the code).
6. **What's next:** the list above.

## If something goes wrong on camera

- **Payment does not complete:** say "test mode", retry once, and cut to the recorded successful run.
- **No "Quote accepted" line:** the notice arrives after Stripe confirms; refresh the Jobs tab once. It disappears when the job page is opened, by design.
- **App not installed in time:** use the web preview of the same screens only as a last resort, and say so.
