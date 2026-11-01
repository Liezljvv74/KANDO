---
description: Security scan of the whole project (Next.js app, Vercel layer, row-level security) with the project's own read-only agents; findings merged by severity
---

Run these three read-only agents in parallel (one message, three Agent calls), each over the whole repository:

1. `nextjs-security-scanner`: data access, secrets behind `NEXT_PUBLIC_`, route handlers that skip the caller or ownership check, whole records returned to clients.
2. `vercel-security-scanner`: environment variable scoping across Production, Preview and Development, preview protection, security headers, secrets in git history.
3. `rls-check`: every table classified in `packages/db/src/rls.ts`, each policy, guard triggers, and an isolation test per private table (this project uses Neon Postgres, not Supabase).

If an agent cannot start, say so and treat that area as NOT scanned: never report it as clean.

Merge the three reports into one list grouped **critical / high / medium / low**: file, what is wrong, how it could be abused, suggested fix, which agent found it. Say plainly what was not checked (dashboard settings the agents cannot see). Do not edit code and never print a secret. Offer to save the result as `docs/security-scan-<date>.md` (the earlier one is `docs/security-scan-2026-10-29.md`).
