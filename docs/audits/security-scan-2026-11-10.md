# Security scan, 10 November 2026

Scope: `main` at 7b79e41 (after #114). Three read-only scans (Next.js data security, Vercel deployment layer from the repository, row-level security) and a search of the git history for secrets. Documents only; no code was changed.

## Result

**No critical or high findings** in the code, the row-level security rules or the git history. The history search covered all added lines (about 27 MB) and found only fake test keys and localhost URLs. No `.env` file was ever committed.

## Row-level security

- All 41 tables are classified in `packages/db/src/rls.ts`, with no duplicates (the new `feedback_attempts` and `help_topics` included). Every private table has an isolation test.
- No policy trusts a column that a user can edit. The bookings trigger takes price and currency from the quote; the app role cannot insert bookings or change the money columns.
- Every route that uses the owner connection checks the caller first; the cron routes fail closed (401 without `CRON_SECRET`).

## Medium findings (none exploitable through the app today)

| # | Finding | Plan |
| --- | --- | --- |
| 1 | The Content-Security-Policy is report-only: the browser still runs injected scripts and nobody receives the reports. A proper policy needs a per-page token. | Known, planned after submission |
| 2 | `docs/deployment.md` listed one cron job (four exist) and omitted the Stripe, push and bypass variables and their scoping. | Fixed in this pull request |
| 3 | The translation endpoint can be triggered by signed-out callers (paid call). Hourly and daily limits bound the cost. | Require sign-in, planned |
| 4 | The two unapproved Help topics are hidden only by the route's query, not in the database. | Future-proofing, planned |
| 5 | Database rules let the owner of a provider's profile edit an open request; the app does not expose it. A trigger would make it airtight. | Planned |
| 6 | Two private tables are tested only through domain specs; most staff-only tables have no explicit "denied" test. | Planned |

## Low

Shared rate-limit bucket when the IP header is missing (Vercel always sends it); an old branch filter in `vercel.json`; no `preload` on the HSTS header (deliberate).

## Not checked by the scans (owner checklist, Vercel and Neon dashboards)

1. Preview environment variables hold only dev values (no production database string, live Stripe key, `CRON_SECRET` or production email key); the Preview AI key is separate and capped. The repository is public.
2. Database strings, cookie secret, storage keys, AI key, email key, `CRON_SECRET` and Stripe keys are marked Sensitive.
3. Both database variables show 10 November or later as updated on Production (password rotated that day).
4. Deployment Protection covers Preview and per-deployment URLs.
5. Fork pull requests need approval; `main` is the only production branch.
6. All four crons are registered; `CRON_SECRET` is set on Production.
7. Stripe uses test keys only; the StepIn webhook stays disabled until testing is finished.
8. GitHub: the two CI secrets exist; secret scanning and push protection are on.
9. Neon: the app role has no BYPASSRLS.

The production database password was exposed in a screenshot and a chat on 10 November and was rotated the same day; Vercel was updated and production redeployed and checked.
