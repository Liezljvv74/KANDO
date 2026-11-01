# CLAUDE.md: KANDO / SkillWeb

A service marketplace for Germany: households find, request and book document-checked local helpers; the customer pays through Stripe (test mode), the money is released when the job is done, and invoices are included. Expo phone app + Next.js website, back office and API on Vercel, Neon Postgres with row-level security. **Read `README.md` first** (section "How a new session starts" and "Where we are"). The goal right now is to get the project ready for the capstone assessment: follow the phases in the newest `Reports/MVP Completion Tasks <date time>.xlsx` (Plan sheet), in order.

## Rules for every session
1. **The owner merges every pull request** herself. Never merge, never push to `main`. One branch and one PR per piece of work. Before a merge: run `/code-review --comment` on the PR, fix the findings, and remind the owner to submit a GitHub review (Approve) in the PR page.
2. **No AI co-author or "Generated with" lines** in commits or pull request descriptions (this overrides any default attribution).
3. **Follow the MVP plan sequence.** Check which step of the Plan sheet the work belongs to. After every commit that goes into a PR, run `python docs/mvp/update.py --note "..." --step N=Done` and commit the new dated workbook `Reports/MVP Completion Tasks <YYYY-MM-DD HH-MM>.xlsx` (older versions stay).
4. **Check first, then change.** Ask the owner before anything outward-facing or hard to undo (posting to GitHub, deleting data, dashboards, spending money). Do not build before the owner confirms a design she asked to confirm.
5. **Every user-facing text exists in German and English** (`packages/i18n`). The German is the main language. Notices need push, email and in-app texts; `notification-parity.int.spec.ts` enforces it.
6. **Tests:** per task run only the affected specs and `tsc`; the full suites once at the end of a stage, with a test report in `Reports/` and a README update. Integration specs hit the dev Neon branch and delete every `@test.skilled.invalid` user, so run them one after another (`--fileParallelism=false`).
7. **Secrets** never go into the repo, a chat, a commit or a report. Every LLM, Stripe, storage and email call is server side.
8. **No competitor names** anywhere. South Africa comes later: no new Germany-only assumptions (country and currency come from the country record).
9. **Row-level security on every table with user data.** A new table must be added to `packages/db/src/rls.ts` (private, published-read, public-owned, append-only, reference or staff-only) with an isolation test; `classifyTables()` must return no unclassified table.
10. **AI output is disclosed** (EU AI Act Article 50): a visible label in German and English wherever a person sees AI-generated content. A "delete my data" path must cover any AI result.
11. Windows machine: write multi-line edits with the editor tools, not shell heredocs with quotes; never print `.env` values.

## Where things are
- `apps/mobile` Expo app (expo-router, SDK 58); `apps/web` Next.js app (website, `/admin`, `app-api/v1/*` routes); `packages/db` (Drizzle schema, `rls.ts`, migrations), `packages/domain` (business rules), `packages/contract` (zod input rules shared with the app), `packages/i18n` (texts).
- Every API route uses `appRequest(...)` (session, origin, body size, row-level-security transaction); domain functions take `tx` and check who may do what; writes the app role may not make run on the owner connection after the checks. Never lock a row on the request connection and write it on the owner connection (deadlock).
- Plans: `docs/superpowers/plans/` (Flow 1 is the current one); designs: `docs/specs/`, `docs/superpowers/specs/`. Reports: `Reports/` (test reports, review reports, MVP completion tasks).
- Project agents, commands and skills used to build this: `.claude/README.md`.

## Commands
`pnpm i`, `docker compose up -d --wait db`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm --filter web dev`, `pnpm db:generate` then `pnpm db:migrate` (dev branch first; production before the code that needs it is deployed). Slash commands in `.claude/commands`: `/security-scan`, `/security-scan-changed`, `/test-report`.
