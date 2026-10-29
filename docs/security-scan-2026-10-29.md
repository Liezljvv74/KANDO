# Security scan, 29 October 2026 (run on `main` after PR #22)

Three read-only scans (Next.js app, database and row-level security, Vercel layer). No critical and no high findings; no secret in the git history of the public repository.

## Fixed in this branch (`security-fixes-3`)
- A public page view with `?translate=1` no longer calls the paid translation model: it shows stored translations only. The Translate button asks the translation route first (the one paid call, rate limited), then loads the page.
- A malformed admin list filter counts as none instead of a 500.
- The remaining JavaScript suspension checks ask the database clock (`isSuspendedNow`).

## Already fixed by PR #15 (the scanners ran on older code first, then these were found done)
- Browser writes from another site are refused (403); suspended users can read but not change anything.

## Open: code (decide and schedule)
- Any caller of the app role can read `owner_id` and `suspended_until` of a published provider (table-wide SELECT grant, `rls.ts`). Public endpoints select named columns, so nothing leaks today; the risk is only SQL run as `app_user`, which could also set `app.user_id` itself. A column-level grant breaks `select *` for owners and the policies, so it needs a larger change (a public view, or reading the own row through a definer function). Not done.
- Anonymous callers can insert into `translations` and `translation_requests`, and `client_key` is publicly readable.
- Admin provider detail returns the whole row; list fields explicitly. Add `server-only` to the db client and auth server files. No rate limit on uploads (Vercel WAF rule). CSP has no `script-src` (try Report-Only first). Reference tables have no RLS, only a SELECT grant.

## Open: Vercel and GitHub dashboards (owner, reminder set for 11:00)
- Remove `CRON_SECRET` from Preview; give Preview its own Resend and OpenRouter keys; mark all secrets Sensitive; check Deployment Protection on previews; turn on GitHub secret scanning and push protection; Vercel Pro before launch.
- Check the Neon Auth cookie flags (SameSite, Secure, HttpOnly) after sign-in, and that the live `app_user` role has no BYPASSRLS.
