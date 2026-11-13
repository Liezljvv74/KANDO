# Security audit (phone) and bot challenge plan, 12 Nov 2026

Status: plan only, nothing built. Needs the owner's confirmation before any build (CLAUDE.md rule 4).
Findings come from reading `apps/mobile`, `apps/web/app/api/auth`, `apps/web/proxy.ts`, `packages/domain`. No `.env` values were read.

## A. Sensitive phone screens

### A1. What exists today
| Item | Finding |
|---|---|
| Screenshot / recording block | None. No `expo-screen-capture`, no FLAG_SECURE anywhere. |
| App-switcher snapshot | Not masked. No `AppState` privacy cover (AppState is only used to refresh data in `(tabs)/_layout.tsx`). |
| Logs | Good. Every `console.warn` is behind `__DEV__` (`api/client.ts`, `lib/pick.ts`, `lib/push.ts`) and logs a path, method or error object, not request bodies. No analytics SDK in the phone app. Web has `@vercel/analytics` (page views only, no form content). `markFailed` stores `e.message` in pending-saves (see A3). |
| Session cookie | In `expo-secure-store` (encrypted, OK). |
| `pending-saves.json` | Written to `Paths.document` as plain JSON (`lib/pending-saves.ts`). Holds the full request `body` of unsent saves (`about`, `service-field`, `service-create`, `account` kinds). The `account` kind can hold street, birth date, name. Not encrypted. Entries expire after 7 days (`MAX_AGE_MS`) and `dropAccount` removes them, but they are not wiped on sign-out unless `dropAccount` is called (verify in `use-session.ts`). |
| Other disk data | Picked photos / ID images are cached by the picker and `expo-image-manipulator` in the app cache folder (not cleaned after upload, to verify). |
| Backups | `app.json` has no `android.allowBackup: false`. Android cloud backup could copy `pending-saves.json`. iOS file backup includes Documents. |

### A2. Screens in scope and proposed protection
Screens: account details (`screens/account-screen.tsx`, `account-data-section.tsx`), ID scan and document upload (`id-scan-button.tsx`, `setup/documents-card.tsx`), payout / IBAN (`setup/payout-card.tsx`), chat (`screens/chat/*`), quotes and invoices (`screens/invoices/*`, quote cards in chat).

1. **Screenshot block, narrowly.** Add `expo-screen-capture` (Expo SDK 58 compatible, config plugin free). Call `usePreventScreenCapture('sensitive')` only inside: ID scan / documents, payout (IBAN), account data section. Not chat, not invoices (people legitimately screenshot an invoice or an agreed price; blocking hurts more than it protects). Android: FLAG_SECURE also hides the app in the recents list for that screen. iOS: `preventScreenCaptureAsync` blanks recordings and screenshots on iOS 11+; it does not stop a photo of the screen.
2. **App-switcher masking.** One small global component: on `AppState` `inactive`/`background`, render a full-screen opaque KANDO logo view; remove on `active`. Covers iOS snapshot (taken at `inactive`) for all screens including chat and invoices. Android: covered on sensitive screens by FLAG_SECURE; the global cover is a second layer. Cost is low; keep it purely visual.
3. **Disk.** (a) Encrypt `pending-saves.json`: keep a random 32-byte key in `expo-secure-store`, encrypt the JSON with `expo-crypto` (AES-GCM is not in expo-crypto; use `react-native-quick-crypto` or `@noble/ciphers` pure JS, small). Cheaper alternative recommended first: do not store sensitive fields on disk at all. Allow-list the `account` kind to keep only a "needs retry" marker and re-read the values from the form, or hold the body in secure-store (2 KB limit per value on iOS older; bodies are small). Decide at build time; recommendation: move the file content into `expo-secure-store` per entry for the `account` kind only. (b) Set `android.allowBackup: false` and exclude the document folder from iOS backup (`NSURLIsExcludedFromBackupKey`, via `expo-file-system` if exposed, else accept). (c) After upload of an ID/document image, delete the cached copy (`File.delete()`), and on sign-out clear `pending-saves.json` and the image cache.
4. **Logs.** Keep the `__DEV__` rule. Add a lint rule or a review check: no `console.*` with a body, a name, an address or an IBAN. In `markFailed` store a status and an error code, not `e.message` if it can echo user text (server messages are error codes today; low risk).

### A3. Accessibility check (EAA: screen readers must never be blocked)
- `usePreventScreenCapture` / FLAG_SECURE only blocks screenshots, recording and screen mirroring. TalkBack, VoiceOver, Switch Access and Voice Control read the view tree, not captured pixels, so they keep working. Android 14+ screen readers are not blocked by FLAG_SECURE. Known caveat: some third-party magnifier or remote-assist apps that capture the screen (not the system screen readers) show black. Mitigation: we only apply it to three screens; add a visible line of help text on those screens ("Screenshots are switched off here to protect your data" in DE and EN) so the behaviour is explained.
- The app-switcher cover must be `accessibilityElementsHidden`-free and render only while the app is `inactive`/`background`, so it never sits over live content while a screen reader is in use. It must not take focus. Add `importantForAccessibility="no-hide-descendants"` is NOT to be used on the real content.
- Do not disable text selection, copy, or accessibility services anywhere. Do not set `accessible={false}` on the real content to hide data.
- Encrypting storage has no screen-reader effect.
- Test checklist (manual, before merge): VoiceOver on iOS and TalkBack on Android on account data, ID scan, payout; confirm focus order and reading still work with prevent-capture on; confirm the cover does not appear when returning from the file picker or camera (these trigger `inactive` on iOS; only show the cover after about 300 ms of inactive state or ignore while a picker is open, otherwise the picker flow flickers).
- The phone has 41 files with accessibility labels; use the existing `accessibilityLabel` patterns for the help line.

### A4. Steps and effort
| Step | Effort |
|---|---|
| A-1 screen-capture on 3 screens + help text DE/EN | 0.5 day |
| A-2 app-switcher cover component, picker flicker handled | 0.5 day |
| A-3 pending-saves: secure-store for `account` kind, clear on sign-out, image cache cleanup, `allowBackup:false` | 1 day |
| A-4 TalkBack/VoiceOver manual test on a real device, short test note in `Reports/` | 0.5 day |
Needs a new dev-client build (native module), so bundle with the next phone build. DPIA note: these are technical measures under GDPR Art. 32; add one line to the DPIA.

## B. Cloudflare Turnstile on sign-up and the email-code step

### B1. Where it plugs in
Auth is Neon Auth (Better Auth) behind one catch-all, `apps/web/app/api/auth/[...path]/route.ts`. The phone calls `/api/auth/sign-up/email`, `/api/auth/email-otp/send-verification-otp`, `/api/auth/email-otp/verify-email` (see `apps/mobile/src/api/auth.ts`). Because every call passes through our route, the check can sit there, before `getAuth().handler()`, with no change to the auth provider.

Protect (POST only): `sign-up/email`, `email-otp/send-verification-otp`, `forget-password`/`email-otp/send-*` (reset), and optionally `sign-in/email` after N failures (step B7). Do not challenge `verify-email` (the code itself is the secret; limit by attempts, see C). Do not challenge sign-out, session, or authenticated routes.

### B2. Mobile approach: options
| Option | How | Pros | Cons |
|---|---|---|---|
| 1. Hosted page in WebView (recommended) | Web app serves `/app-challenge?action=signup&nonce=...` with the Turnstile widget (managed mode). `react-native-webview` shows it in a small modal; on success the page posts the token to the app via `window.ReactNativeWebView.postMessage`. App sends the token in a header `x-turnstile-token` on the auth call. | One widget implementation, works on iOS and Android, keys and rules stay server side, can be changed without an app release. | Adds `react-native-webview` (native, new dev build). Must be accessible: Turnstile's widget is keyboard and screen-reader operable; test with TalkBack/VoiceOver. |
| 2. System browser (`expo-web-browser`, already installed) | Same hosted page opened in an in-app browser tab, returns by deep link `skilled://challenge?token=...`. | No new native module. Existing dependency. | Extra context switch; on Android the Custom Tab return can be lost if the app is killed; token passed in a URL (short-lived, single use, acceptable but logs risk). |
| 3. Native SDK | Cloudflare has no Turnstile RN widget. | n/a | Not available. |
| 4. Alternatives without a widget | Server-side signals only: rate limits (part C), email-domain checks, an app attestation (Play Integrity / App Attest via `expo-app-integrity`-style module). | No user friction. | Attestation needs per-platform work (about 3 to 5 days) and does not cover the web sign-up. Rate limits alone do not stop distributed bots. |

Recommendation: Option 1 with Option 2 as the fallback if the WebView proves flaky. Web sign-up (if/when the website has one) uses the Turnstile script directly, same server check. Use managed (invisible-when-possible) mode so most real people see nothing.

Flow on phone: tap "Sign up" -> app opens the challenge modal only if the server says a token is needed (`GET /app-api/v1/challenge/config` returns `{enabled, siteKey}`; a cached value is fine) -> token returned -> app calls sign-up with header -> same on "send code again". Token is single use and valid 300 s, so request a fresh one per call, not per screen.

### B3. Server side
- New helper `apps/web/lib/turnstile.ts` (plain function, about 30 lines): `verifyTurnstile(token, ip)` POSTs `secret`, `response`, `remoteip` (optional) to `https://challenges.cloudflare.com/turnstile/v0/siteverify`, 3 s timeout, returns `{ok, reason}`. Check `success`, and the returned `action` and `hostname` against what we expect (`signup`, `verify-code`, `reset`; hostname `kando.skillweb.space` or `skillweb.space`).
- Wrap the auth catch-all: for the protected paths, read `x-turnstile-token`; missing or failed -> `403 { error: 'CHALLENGE_REQUIRED' }` (or `CHALLENGE_FAILED`). Everything else passes through unchanged. The body is not read, so the auth handler still gets an untouched request.
- Secret in `TURNSTILE_SECRET_KEY` (Vercel env, Sensitive, per environment). Site key is public (`TURNSTILE_SITE_KEY`, served by the config route, not baked into the app). Never in the repo or logs (rule 7).
- Test mode keys (Cloudflare dummy keys, work against the real endpoint): site `1x00000000000000000000AA` (always passes), `2x00000000000000000000AB` (always blocks), `3x00000000000000000000FF` (forces interactive); secret `1x0000000000000000000000000000000AA` (pass), `2x0000000000000000000000000000000AA` (fail), `3x0000000000000000000000000000000AA` (token already spent). Use these in dev and preview, a real key pair only in production. Integration spec for the wrapper uses a mocked fetch.
- Feature flag: if `TURNSTILE_SECRET_KEY` is not set the check is skipped (local dev, `pnpm test`), and the config route returns `enabled:false`. Production must set it; add a startup note in README.

### B4. Fallback when the challenge is unavailable
- Cloudflare siteverify down or timeout: **fail open with a stricter rate limit** for sign-up and send-code (for example 1/10 min per IP, 3/day per email) and log a counter, rather than blocking all new users. Document this as an owner decision (alternative: fail closed). Recommendation: fail open for send-code and sign-up with the strict limit; never fail open for siteverify returning `success:false`.
- Challenge cannot be shown on the phone (WebView error, no JS, blocked network): show a message and a "Try again" button, plus a contact line in Help; do not silently skip. A person using a screen reader must have an equivalent path: Turnstile managed mode is accessible; if it still cannot be completed, offer "send me a code by email to continue" is NOT a bypass, so the support route is the fallback (Help screen exists).
- Old app versions without the header: gate by app version. Phase in: week 1 `enabled` in report-only mode (log, do not block), then enforce. The config route lets us flip without a release.

### B5. Texts (packages/i18n, German first, then English)
New keys, both languages, parity checked by existing tests:
- `challenge.title` DE "Kurze Sicherheitsprüfung" / EN "Quick security check"
- `challenge.body` DE "Wir prüfen, dass du ein Mensch bist. Das dauert nur einen Moment." / EN "We are checking that you are a person. It only takes a moment."
- `challenge.retry` DE "Erneut versuchen" / EN "Try again"
- `challenge.failed` DE "Die Prüfung hat nicht geklappt. Bitte versuche es noch einmal." / EN "The check did not work. Please try again."
- `challenge.unavailable` DE "Die Prüfung ist gerade nicht erreichbar. Bitte versuche es in ein paar Minuten noch einmal oder schreib uns über Hilfe." / EN "The check is not reachable right now. Please try again in a few minutes or write to us through Help."
- `challenge.screenReaderHint` (accessibilityLabel of the modal) DE "Sicherheitsprüfung, bitte warten oder bestätigen" / EN "Security check, please wait or confirm"
- API error codes `CHALLENGE_REQUIRED`, `CHALLENGE_FAILED` map to the texts above in the app error mapper.
- Terms and privacy policy: add Cloudflare as a processor (see B6) in German and English.

### B6. Privacy / DPIA note
- Turnstile processes IP address, user agent, and browser/device signals to decide human vs bot; Cloudflare acts as processor (Cloudflare DPA, SCCs, EU data-privacy framework listed). Legal basis: legitimate interest (Art. 6(1)(f)) in preventing abuse and securing the service. Turnstile does not use cookies for tracking and is marketed as no-ad-profiling; confirm against current Cloudflare terms at build time.
- In a WebView the widget loads scripts from `challenges.cloudflare.com`; list this in the privacy policy and the processor list; ePrivacy (TDDDG section 25): access to device information may need consent unless strictly necessary for the service; the security purpose is generally treated as strictly necessary, to be confirmed in the DPIA. Record the decision.
- We store nothing from the verdict except an aggregate counter; no token, no IP in our logs (IP only as the hash already used by `ipHashOf`).
- Add to DPIA: purpose, data, processor, retention (none on our side), alternatives considered (rate limits only, attestation).
- AI disclosure rule 10 is unaffected (no AI text shown).

### B7. Steps and effort
| Step | Effort |
|---|---|
| B-1 Cloudflare account, widget, dummy keys in dev/preview env, real keys in production env (owner action, secrets never in chat) | 0.5 h owner |
| B-2 `lib/turnstile.ts` + wrapper in auth catch-all + `challenge/config` route + unit/integration spec | 0.5 day |
| B-3 Hosted challenge page `/app-challenge` (public, CSP allows `challenges.cloudflare.com`, `frame-src` / `script-src`), accessible markup | 0.5 day |
| B-4 Mobile: `react-native-webview`, modal component, hook `useChallenge(action)`, header on sign-up / send-code / reset calls, error mapping | 1 day |
| B-5 i18n keys DE/EN, privacy policy + terms text, DPIA paragraph | 0.5 day |
| B-6 Fallback + report-only phase + rate limit hook (needs part C), TalkBack/VoiceOver test | 0.5 day |
| B-7 (optional) challenge on sign-in after 5 failures per email/IP | 0.5 day |
Total about 3.5 to 4 days. New dev-client build needed for the WebView. PR split: PR1 server (B-2, B-3), PR2 phone + texts (B-4, B-5), PR3 enforce flag. Owner merges each. Roll out report-only first.

## C. Rate limits and scraping limits

### C1. Findings
Existing: chat send limit (`assertSendRate`, DB count under advisory lock), feedback limit using `ipHashOf` and a table keyed by ip hash (`packages/db/src/schema/feedback.ts`). No generic limiter. `appRequest` has no limit. `/api/auth/*` has only whatever Neon Auth does internally (not controlled by us; Neon Auth has its own basic rate limiting, details unverified). Signed-out browse: `GET /app-api/v1/providers`, `/providers/[slug]`, `/categories`, `/services`, and the public website (`proxy.ts` rewrites all pages; sitemap, robots exist).

### C2. Storage choice
Recommend **a Postgres table in Neon** (fixed-window counters), reusing the pattern already used for feedback and chat: no new vendor, works on Vercel serverless, easy to test, and add to `rls.ts` as a staff-only / reference table with an isolation test (rule 9). Cost: one indexed upsert per limited request (about 2 to 5 ms on the owner connection); fine at MVP scale.
- Table `rate_limits(key text, window_start timestamptz, count int, primary key (key, window_start))`; `INSERT ... ON CONFLICT DO UPDATE SET count = count + 1 RETURNING count`; a cron job (existing `/api/cron`) deletes rows older than 1 day. Key holds a hash, never a raw IP or email (reuse `ipHashOf`; email hashed with a server pepper).
- Upgrade path (not now): Upstash Redis via the Vercel Marketplace with `@upstash/ratelimit` (sliding window, lower latency) if traffic grows or the Neon write load matters. Vercel WAF rate limiting rules can add a coarse per-IP cap in front for free/cheap, as a second layer (owner dashboard action, ask first).
- Do not use in-memory limiters (serverless instances do not share state).

### C3. Where the limit sits
One helper `rateLimit(name, key, max, windowSec)` in `packages/domain` (or `apps/web/lib`), called by `appRequest` through a new optional option, e.g. `appRequest({ auth: 'optional', limit: { name:'browse', per:'ip', max:120, windowSec:60 } }, ...)`, and by the auth catch-all wrapper. Response: `429 { error: 'RATE_LIMITED' }` with `Retry-After`. Phone app already treats 429 as retryable (`classifyFailure`), keep that. New i18n key `errors.rateLimited` in DE and EN.

### C4. What to limit (suggested thresholds, tune after a week of logs)
| Route group | Key | Limit |
|---|---|---|
| `sign-up/email` | ip hash | 5 per hour, 20 per day |
| `sign-up/email` | email hash | 3 per hour |
| `email-otp/send-verification-otp` and reset mails | email hash | 3 per 10 min, 10 per day |
| same | ip hash | 10 per hour |
| `verify-email` (code guess) | email hash | 5 attempts per code, then lock 15 min (6-digit code = 1M combos; 5 tries is safe) |
| `sign-in/email` | email hash + ip hash | 10 per 15 min; after 5 failures require Turnstile (B7) |
| `forget-password` / reset | email hash, ip hash | 3 per hour, 10 per hour |
| Signed-out browse: `GET /providers`, search, categories | ip hash | 60 per minute, 1,000 per hour |
| Signed-out `GET /providers/[slug]` (profile detail) | ip hash | 30 per minute, 300 per hour; distinct slugs per hour 150 (scraper signal) |
| Signed-out photos / file links | ip hash | 120 per minute |
| Feedback (exists) | ip hash | keep |
| Chat send (exists) | user | keep |
| Authenticated reads | user id | 300 per minute (generous, abuse backstop only) |
Phones on mobile carriers share IPs (CGNAT), so IP limits must be generous; the email key is the stricter one for auth.

### C5. Anti-scraping for signed-out browse
- Hard page size cap on search (check `SearchQuerySchema`, for example max 20 per page and a deep-page cap of 10 pages for signed-out callers; sign-in required beyond).
- Signed-out responses already hide the street; keep contact data, exact address, phone and email out of public output (confirm no field leaks in `providers/[slug]`).
- Distinct-profile-per-hour counter above; on breach return 429 and, if Turnstile is on, require a challenge cookie for the website.
- robots.txt disallow for `/app-api/`, `Cache-Control` (public CDN cache) on public list/detail responses so the cache absorbs repeat hits before the function runs; website pages already render as cached per language.
- Optional later: Vercel Bot Protection / Firewall (owner decision, outward-facing, ask first); signed short-lived page cursors instead of numeric offsets.
- Do not block known good crawlers (Google, Bing) on public website pages; the limit applies to `/app-api`, not to the cached website HTML.

### C6. Steps and effort
| Step | Effort |
|---|---|
| C-1 table + migration + `rls.ts` classification + isolation test + cleanup in cron | 0.5 day |
| C-2 `rateLimit` helper + `appRequest` option + spec | 0.5 day |
| C-3 apply to auth catch-all (sign-up, send-code, verify attempts, sign-in, reset) | 0.5 day |
| C-4 browse limits, page caps, cache headers, robots | 0.5 day |
| C-5 i18n `errors.rateLimited` DE/EN, app error message, log-only mode first | 0.25 day |
| C-6 tests: affected specs + tsc; full suites at stage end | 0.25 day |
Total about 2.5 days. Do C before enforcing B (B-6 uses the strict fallback limit). Log-only for one week, then enforce.

## Suggested order and questions for the owner
1. C-1..C-3 (rate limits, no new native build) -> 2. B server (PR1) -> 3. A + B phone changes in one dev-client build -> 4. enforce flags.
Questions: (a) fail open or closed when Cloudflare is down (recommend open with strict limits); (b) screenshot block on chat/invoices: recommended NO; (c) create the Cloudflare account and widget (owner action); (d) allow a Vercel WAF rule (dashboard change).
Unverified: Neon Auth's own built-in rate limits; whether `sign-out` already calls `dropAccount` for pending saves; exact `SearchQuerySchema` page cap; Cloudflare dummy key values (verify in Cloudflare docs before use).
