# Row-level security and sign-in: evidence note

For the capstone assessment. Written 1 November 2026. The stack uses **Neon** (Postgres with row-level security and Neon Auth, built on Better Auth) instead of Supabase; the course lead approved this (confirmed by the owner on 1 November 2026). The requirements of the criteria are met on Neon as follows.

## Sign-in (authentication)
- Neon Auth (Better Auth) issues the session cookie; email confirmation by code, password reset by code, session length 7 days.
- Every API route is wrapped by `appRequest` (`packages/domain/src/app-request.ts`): it reads the session on the server, refuses a cookie write without a matching Origin, limits the body size, opens a database transaction as the signed-in person, and sets `Cache-Control: private, no-store`. A signed-out visitor gets 401 on every private route and sees the sign-in screen in the app.
- Staff areas (`/admin`) need a staff role; the reviewer role cannot see payment or tax data.

## Row-level security
- **Two database roles.** Every app request runs as `app_user` under row-level security (`appPool`); migrations, cron jobs and settlement run on the owner connection, only after the domain code has checked who may do what. Row-level security is enabled on the tables and the owner role bypasses it (it is never FORCEd), which is why the owner connection is used only after the domain code has checked the caller. The `app_user` role is created without BYPASSRLS; checking that on the live database is still on the owner's checklist (README, pre-launch tasks).
- **Every table is classified** in `packages/db/src/rls.ts`: private (owner only), public-owned (public read, owner write), published-read (readable only when published or only by the two parties), append-only, public reference (read-only), or staff-only (all app privileges revoked). On the Flow 1 branch (PR #47) that is 38 tables: 10 private, 4 public-owned, 7 published-read, 2 append-only, 6 reference, 9 staff-only; `classifyTables()` returns no unclassified and no duplicated table and is asserted by `apps/web/tests/db-migrations.int.spec.ts`.
- **Status and money are guarded by triggers**, not only by policies: `APP_STATUS_MOVES` (which side may make which status change), `IMMUTABLE_COLUMNS` (parties of a row never change), `COLUMN_STAFF_ONLY` (money, payment and ending columns cannot be written by the app role), and `app_status_guard` (for example: a request's answer deadline and revision count cannot be changed by the app role, and its time, place and note are frozen once a quote exists).
- **Policies are re-applied on every migration** (`pnpm db:migrate` runs `rls.ts` atomically), so the database cannot drift from the code.
- **Isolation tests** run against a real Postgres: `apps/web/tests/rls*.int.spec.ts` (generic, bookings, chat, endings, payments, providers) plus the per-feature specs; they prove that one user cannot read or change another user's rows and that guarded columns refuse app-role writes.
- **Deleting and exporting** your data: the account page exports the person's own data (JSON or CSV) and deletes the account in one transaction (password required), then removes files and the Neon Auth records.

## Secrets
Keys (Neon, Stripe, Resend, OpenRouter, storage, cron) live in Vercel environment variables, are read on the server only, and are not in the repository or its history (security scan of 29 October 2026: no secret in history). Every LLM, Stripe, email and storage call is server side.

## Not covered by this note
The stack difference to the course material is Supabase (Auth + RLS) versus Neon (Neon Auth + Postgres RLS): the concepts are the same, the product is different. The last full security scan is `docs/security-scan-2026-10-29.md`; a new scan is a planned step (MVP plan, phase 3).
