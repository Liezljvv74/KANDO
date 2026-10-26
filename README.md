# KANDO: SkillWeb rebuilt

The new home of SkillWeb, a service marketplace for Germany: households book trusted, verified local helpers and small businesses, pay when the job is done, and get the paperwork included. This repository replaces the earlier Payload-based repository (`SkillWeb`), which stays as reference until this one reaches feature parity and is then archived.

- **Design:** `docs/specs/2026-10-26-kando-foundation-design.md` (what the first release does, the decided stack, the rules, the stages).
- **Stack:** Expo app; Next.js on Vercel for the website, the staff back office (Refine) and the API; Neon Postgres (PostGIS, row-level security, Auth, Object Storage, Realtime); Drizzle; Inngest for background work; Stripe behind a payments interface; one text catalogue in German and English.
- **Rules for this project:** every change through a pull request merged by the owner; a test report in `Reports/` after every stage and every big change; no competitor names anywhere; no AI co-author or "Generated with" lines; every user-facing text exists in German and English; South Africa follows later, so no new Germany-only assumptions.

Layout once Stage 1 starts: `apps/mobile`, `apps/web`, `packages/db`, `packages/contract`, `packages/i18n`, `packages/domain`, `Reports/`, `docs/`.
