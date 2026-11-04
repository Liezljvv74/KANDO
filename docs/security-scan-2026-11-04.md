# Security scan and secrets scan, 4 November 2026 (MVP plan steps 3.1 and 3.2)

Code scanned: `main` at `c3cf63b` (includes PR #85). Method: the project's own scanners run read-only (Next.js data security, Vercel deployment layer, row-level security), a secrets scan over the working tree and the full git history (198 commits), and `pnpm audit --prod`. No secret value was printed anywhere.

## Result in one paragraph

No critical finding in the code, no real secret in the repository or its history, and row-level security is sound (39 of 39 tables classified, the app role cannot bypass it). One real high finding was fixed in this PR (declining a request showed the customer's street to the provider). Two high findings sit in the Vercel dashboard and only the owner can fix them (see "Owner actions").

## Fixed in this PR

| Finding | Where | Fix |
|---|---|---|
| High: the decline answer carried the customer's street to the provider | `bookings/requests.ts` (`closeRequest`) | the provider's answer goes through `hideStreet`; new test `requests-quotes.int.spec.ts` |
| High (dependency): `sharp` 0.34.5 has image-library flaws (libvips, libheif, librsvg) and decodes uploaded photos | `apps/web` and `packages/domain` | both pinned to 0.35.5; the 95 image specs pass |
| Low: publishing after stop-offering left the provider flag off | `providers/profile.ts` (`publish`) | publishing is an explicit offer and sets the flag |
| Low: a person with stale terms could not take their profile offline | `stop-offering` and `unpublish` routes | `allowStaleTerms: true` (both only reduce exposure) |
| Medium: any account could make every public provider page re-render by calling stop-offering | `stop-offering` route | the cache is refreshed only when a provider row existed |
| Low: CI token had default rights; language cookie without `Secure` | `ci.yml`, `lib/admin/lang.ts` | `permissions: contents: read`; `Secure` added |

## Owner actions (dashboards, cannot be done from the repo)

1. **Vercel, Deployment Protection (high):** preview and per-deployment URLs answered 200 without a login; turn on Vercel Authentication for "All deployments except Production" (the Stripe preview webhook then needs the bypass secret from the README).
2. **Vercel, Environment Variables (high):** `CRON_SECRET`, `RESEND_API_KEY`, `OPENROUTER_API_KEY`, `TRANSLATE_MODEL` and `PAYMENTS_ENABLED` are ONE variable for Production and Preview; untick Preview and give Preview its own test values. Check that each secret is type Sensitive, that Preview uses a `sk_test_` Stripe key and its own storage key.
3. **Vercel Firewall (medium):** rate-limit rules for `/api/auth/*`, `DELETE /app-api/v1/me`, `GET /app-api/v1/me/export` and the upload routes (sign-in limits may be shared by all users; decode work runs before per-user limits).
4. **GitHub:** turn on secret scanning and push protection (Settings, Code security); confirm the CI secrets point at the dev branch.
5. **Neon Auth:** switch on a second factor for staff accounts if available; ask Neon when `better-auth` 1.7.7 or later reaches the hosted service.

## Accepted for now (recorded, not fixed)

- `better-auth` (critical and high advisories, OAuth proxy and magic link): comes with the Neon Auth SDK, whose latest version still pins 1.7.6. KANDO uses the hosted service and configures neither OAuth proxy nor magic link, so the code is not reachable from here. Re-check when the SDK moves.
- `node-forge`, `zod`, `glob`, `minimatch`, `esbuild`, `deepmerge` (Expo build tooling and drizzle-kit) and `path-to-regexp` (back-office UI library, slow-request only): not part of the shipped phone app.
- CSP: only `frame-ancestors`, `object-src` and `base-uri` are enforced; `script-src` is report-only. Promote it when nonces are ready.
- A request created at the very moment a provider stops offering can slip through the open-work check.
- Medium, design choices to decide later: the terms gate does not apply to accounts that never accepted (M1); revisions of a request are not rate-limited and can notify a provider repeatedly (M4); a provider owner may edit an open request's details at policy level (RLS M4); `bookings.reminded_*` and `users.terms_*` are writable by the account holder (RLS L1, L4); the owner connection is not forced under RLS (by design; a lint that lists every route using `db` would catch a new one).

## Not checked

Vercel settings the CLI cannot read (Deployment Protection, fork-PR protection, WAF), variable values, Neon storage bucket policies, whether the deployed grants equal `rls.ts` (no read-only access to production was used), the Neon Auth session cookie flags (needs a signed-in browser), and `.docx`/`.xlsx` files in history (not text-scanned).
