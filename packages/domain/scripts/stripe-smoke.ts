export {}
// Manual Stripe TEST-mode smoke check of the real gateway. No money moves: it creates a test account, an onboarding link and an
// unpaid Checkout session. Prints only ids, URLs and statuses, never a key. Run: pnpm payments:smoke
process.env.PAYMENTS_ENABLED = 'true'
const key = process.env.STRIPE_SECRET_KEY || process.env.Stripe_Secret_Key || ''
if (!key) throw new Error('No Stripe key: set STRIPE_SECRET_KEY (a test key) in .env')
if (/^(sk|rk)_live_/.test(key)) throw new Error('Refusing to run with a live key')
if (!/^(sk|rk)_test_/.test(key)) throw new Error('Refusing to run: the key is not a Stripe test key')
process.env.STRIPE_SECRET_KEY = key
process.env.STRIPE_WEBHOOK_SECRET ||= 'whsec_smoke_test_only' // only so verifyEvent has a secret to check against

const { gateway, BadSignatureError } = await import('../src/payments/gateway')
const g = gateway()
const run = `smoke-${Date.now()}`
const base = process.env.NEXT_PUBLIC_SERVER_URL || 'https://example.com'
const results: string[] = []
const report = (step: string, status: 'PASS' | 'FAIL' | 'SKIPPED', detail: string) => {
  results.push(status)
  console.log(`${status.padEnd(7)} ${step}: ${detail}`)
}
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).split(key).join('[key]')

let accountId: string | undefined
try {
  accountId = (await g.createAccount({ email: `${run}@example.com`, country: 'DE', providerId: run, idempotencyKey: `account:${run}` })).accountId
  report('a1 create connected account (Accounts v2)', 'PASS', accountId)
} catch (e) {
  report('a1 create connected account (Accounts v2)', 'FAIL', `${msg(e)} (switch on Connect and Accounts v2 in the Stripe sandbox, and give the key Connect v2 account write)`)
}
if (accountId) {
  try {
    const l = await g.onboardingLink({ accountId, returnUrl: `${base}/return`, refreshUrl: `${base}/refresh` })
    report('a2 onboarding link', 'PASS', l.url.split('?')[0] ?? '')
  } catch (e) {
    report('a2 onboarding link', 'FAIL', msg(e))
  }
} else report('a2 onboarding link', 'SKIPPED', 'no account')

try {
  const c = await g.createCheckout({
    bookingId: run, providerId: run, customerId: run, amountCents: 1234, currency: 'EUR', description: 'KANDO smoke test (not paid)',
    successUrl: `${base}/paid`, cancelUrl: `${base}/cancel`, expiresAt: new Date(Date.now() + 60 * 60 * 1000), idempotencyKey: `checkout:${run}`,
  })
  report('b checkout session 12.34 EUR (unpaid)', 'PASS', `${c.sessionId} ${c.url.split("#")[0]}`)
} catch (e) {
  report('b checkout session 12.34 EUR (unpaid)', 'FAIL', msg(e))
}

if (accountId) {
  try {
    const ready = await g.accountReady(accountId)
    report('c accountReady', ready === false ? 'PASS' : 'FAIL', `${ready} (expected false)`)
  } catch (e) {
    report('c accountReady', 'FAIL', msg(e))
  }
} else report('c accountReady', 'SKIPPED', 'no account')

try {
  g.verifyEvent('{"id":"evt_x","type":"x"}', 't=1,v1=00')
  report('d bad signature', 'FAIL', 'did not throw')
} catch (e) {
  report('d bad signature', e instanceof BadSignatureError ? 'PASS' : 'FAIL', e instanceof BadSignatureError ? 'BadSignatureError' : msg(e))
}
const server = process.env.NEXT_PUBLIC_SERVER_URL
if (!server) report('e webhook reachable', 'SKIPPED', 'NEXT_PUBLIC_SERVER_URL not set')
else {
  // a bad-signature POST: the deployment's webhook must answer 400 JSON (reached, payments on, signature checked); it changes nothing
  const step = 'e webhook reachable'
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET // optional: the Preview's Protection Bypass for Automation secret, as Stripe sends it in the URL
  try {
    const r = await fetch(`${server.replace(/\/$/, '')}/api/stripe/webhook`, { method: 'POST', body: '{}', headers: { 'stripe-signature': 't=0,v1=bad', ...(bypass && { 'x-vercel-protection-bypass': bypass }) }, redirect: 'manual' })
    const json = (r.headers.get('content-type') ?? '').includes('application/json')
    if (r.status === 400 && json) report(step, 'PASS', '400 bad signature')
    else if (r.status === 404) report(step, 'FAIL', '404: payments are off on that deployment')
    else if (r.status === 401 || r.status === 403 || !json) report(step, 'FAIL', `${r.status}: Deployment Protection blocks Stripe: add the bypass to the webhook URL`)
    else report(step, 'FAIL', `unexpected ${r.status}`)
  } catch (e) {
    report(step, 'FAIL', `network error: ${msg(e)}`)
  }
}
console.log('Not covered: transfer and refund (need a paid charge), a paid checkout end to end (README "Stripe test-mode set-up (owner)").')
process.exit(results.includes('FAIL') ? 1 : 0)
