---
description: Security scan limited to the files changed against main (Next.js app, Vercel layer, row-level security); findings merged by severity
argument-hint: "[base-branch, default main]"
---

Find the changed files: `git diff --name-only <base>...HEAD` (base = the argument, default `main`) and uncommitted changes. If nothing changed, say so and stop.

Run these three read-only agents in parallel (one message, three Agent calls), each told to look at the changed files and what they touch (routes, domain functions, schema and `rls.ts` changes, `vercel.json`, environment use):

1. `nextjs-security-scanner`
2. `vercel-security-scanner`
3. `rls-check` (only when `packages/db` changed; otherwise skip it and say so)

If an agent cannot start, say so and treat that area as NOT scanned: never report it as clean. Merge the reports into one list grouped **critical / high / medium / low**: file, what is wrong, how it could be abused, suggested fix, which agent found it. Do not edit code and never print a secret.
