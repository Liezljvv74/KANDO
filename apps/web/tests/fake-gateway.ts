import { randomUUID } from 'node:crypto'

import type { GatewayEvent, PaymentsGateway } from '@kando/domain'

export type FakeGateway = PaymentsGateway & {
  calls: { method: string; args: unknown }[]
  /** Account ids that accountReady reports as ready. */
  ready: Set<string>
  /** A body and signature that this gateway's verifyEvent accepts. */
  event(e: GatewayEvent): { body: string; signature: string }
}

/**
 * In-memory gateway for tests. Like Stripe, a repeated idempotency key with identical parameters returns the first
 * result and is recorded once; the same key with different parameters throws (Stripe's idempotency_error).
 * It does not check the Checkout expiry range (tests may pass a fixed `now`).
 * To simulate a failure, replace a method: `g.transfer = async () => { throw new Error('down') }`.
 */
export function fakeGateway(): FakeGateway {
  const calls: FakeGateway['calls'] = []
  const byKey = new Map<string, { params: string; result: unknown }>()
  const signed = new Map<string, string>() // signature -> body
  let n = 0

  const record = (method: string, args: unknown) => calls.push({ method, args })
  async function once<T>(method: string, args: { idempotencyKey: string }, make: (id: number) => T): Promise<T> {
    const params = JSON.stringify([method, args])
    const seen = byKey.get(args.idempotencyKey)
    if (seen) {
      if (seen.params !== params) throw new Error(`idempotency_error: key ${args.idempotencyKey} was used with different parameters`)
      return seen.result as T
    }
    record(method, args)
    const result = make(++n)
    byKey.set(args.idempotencyKey, { params, result })
    return result
  }

  const g: FakeGateway = {
    calls,
    ready: new Set(),
    createAccount: (args) => once('createAccount', args, (i) => ({ accountId: `acct_fake_${i}` })),
    async onboardingLink(args) {
      record('onboardingLink', args)
      return { url: `https://stripe.fake/onboarding/${args.accountId}` }
    },
    async accountReady(accountId) {
      record('accountReady', { accountId })
      return g.ready.has(accountId)
    },
    createCheckout: (args) => once('createCheckout', args, (i) => ({ sessionId: `cs_fake_${i}`, url: `https://stripe.fake/pay/cs_fake_${i}` })),
    transfer: (args) => once('transfer', args, (i) => ({ transferId: `tr_fake_${i}` })),
    refund: (args) => once('refund', args, (i) => ({ refundId: `re_fake_${i}` })),
    verifyEvent(rawBody, signature) {
      if (signed.get(signature) !== rawBody) throw new Error('Invalid signature')
      return JSON.parse(rawBody) as GatewayEvent
    },
    event(e) {
      const body = JSON.stringify(e)
      const signature = `fake_sig_${randomUUID()}`
      signed.set(signature, body)
      return { body, signature }
    },
  }
  return g
}
