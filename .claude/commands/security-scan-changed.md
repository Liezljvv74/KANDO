---
description: Run the Supabase, Next.js and Vercel security scanners in parallel on files changed vs main, then merge findings by severity
argument-hint: "[base-branch, default main]"
---

# Security scan of changed files

Base branch: use `$ARGUMENTS` if given, otherwise `main`.

This is a report-only command. Do not edit, create or delete any project files, and tell each scanner the same.

## 1. Find the changed files

Run these in the repo root and combine the results into one de-duplicated list:

- `git diff --name-only <base>...HEAD` for commits on this branch that aren't on the base
- `git diff --name-only HEAD` for uncommitted changes, staged or not
- `git ls-files --others --exclude-standard` for new files not yet tracked

Drop deleted files (paths that no longer exist). If the list is empty, say there is nothing to scan and stop without starting any scanners.

## 2. Dispatch all three scanners in parallel

Start `supabase-security-scanner`, `nextjs-security-scanner` and `vercel-security-scanner` together, as three Agent calls in a single message so they run concurrently. Give each one the same brief:

- The full list of changed files, plus the base branch name.
- Scan **only** those files. Don't audit the rest of the codebase. Read other files only to understand a changed file, for example to follow an import, to check whether a changed route handler goes through the auth helper, or to see whether an env var used in a changed file is a secret.
- If no changed file is relevant to its area, say "no relevant changes" and stop.
- Report only. Make no code changes.
- Return each finding with severity (critical, high, medium or low), file and line, what's wrong, and how to fix it.

## 3. Combine the reports

Wait for all three to finish, then write one report:

- Start with the base branch, the number of changed files, and one line per scanner saying whether it found issues or had no relevant changes.
- Group every finding under **Critical**, **High**, **Medium** and **Low**, in that order. Under each finding give the file and line, the scanner that raised it, the issue, and the fix.
- If two scanners report the same problem in the same place, list it once and name both scanners.
- Leave out any severity group that has no findings. If there are no findings at all, say so plainly.
- If a scanner failed or returned nothing, say so rather than treating it as a clean result.
