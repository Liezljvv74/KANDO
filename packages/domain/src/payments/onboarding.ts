import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import { availabilityWatches, db, providers, users, type Tx } from '@kando/db'
import { DEFAULT_LANG, isLang } from '@kando/i18n'
import { notifyBookingEvent } from '../bookings/notify'
import { siteBase } from '../notifications'
import type { Exec } from '../providers/eligibility'
import { fail } from '../providers/http'
import { ownProvider } from '../providers/profile'
import { gateway } from './gateway'

const noProfile = () => fail(409, { error: 'Create your profile first' })

/**
 * The Stripe-hosted payout set-up for the caller's own provider profile (anyone without one: 409). The connected account
 * is created once (key `account:<providerId>`) and its id stored on the owner connection (staff-only column); every call
 * returns a fresh onboarding link. Return and refresh lead to /payout-done, which carries nothing but the language.
 */
export async function startPayoutSetup(tx: Tx, userId: string): Promise<{ url: string }> {
  const own = (await ownProvider(tx, userId)) ?? noProfile()
  const [user] = await tx.select({ email: users.email, language: users.language }).from(users).where(eq(users.id, userId))
  const lang = isLang(user?.language) ? user.language : DEFAULT_LANG
  const accountId = own.stripeAccountId ?? (await createAccountOnce(own.id, own.country, user!.email))
  const back = `${siteBase()}/payout-done${lang === DEFAULT_LANG ? '' : `?lang=${lang}`}`
  return gateway().onboardingLink({ accountId, returnUrl: back, refreshUrl: back })
}

/** Two set-ups at once take turns on a per-provider lock: the second finds the stored id, so exactly one account exists. */
async function createAccountOnce(providerId: string, country: string, email: string): Promise<string> {
  // ponytail: the lock is held across the one Stripe call (15 s timeout); only parallel set-ups of the same provider wait
  return db.transaction(async (o) => {
    await o.execute(sql`SELECT pg_advisory_xact_lock(hashtext('payout_setup'), hashtext(${providerId}))`)
    const stored = (await o.select({ a: providers.stripeAccountId }).from(providers).where(eq(providers.id, providerId)))[0]?.a
    if (stored) return stored
    const { accountId } = await gateway().createAccount({ email, country, idempotencyKey: `account:${providerId}` })
    await o.update(providers).set({ stripeAccountId: accountId }).where(eq(providers.id, providerId))
    return accountId
  })
}

/** Asks the gateway whether the caller's payouts are ready and records it, so the app is right before the webhook arrives. */
export async function payoutStatus(tx: Tx, userId: string): Promise<{ ready: boolean }> {
  const own = (await ownProvider(tx, userId)) ?? noProfile()
  if (!own.stripeAccountId) return { ready: false }
  const ready = await gateway().accountReady(own.stripeAccountId)
  await recordReady(db, own.stripeAccountId, ready)
  return { ready }
}

/** The `account-updated` event: re-reads the account's state from the gateway. An account no provider holds is ignored. */
export async function refreshAccount(exec: Exec, accountId: string): Promise<void> {
  const known = await exec.select({ id: providers.id }).from(providers).where(eq(providers.stripeAccountId, accountId))
  if (!known.length) return
  await recordReady(exec, accountId, await gateway().accountReady(accountId))
}

/**
 * Sets or clears payouts_ready_at (owner connection). Only the change to ready tells anyone: the provider
 * (payout-setup-complete), then every watcher not told yet (provider-available). Both UPDATEs are conditional, so with
 * concurrent calls (status, webhook) exactly one sees the change and each watcher is told once. Messages after the commit.
 */
async function recordReady(exec: Exec, accountId: string, ready: boolean, now = new Date()): Promise<void> {
  const after: (() => Promise<void>)[] = []
  await (exec as typeof db).transaction(async (o) => {
    const byAccount = eq(providers.stripeAccountId, accountId)
    if (!ready) {
      await o.update(providers).set({ payoutsReadyAt: null }).where(and(byAccount, isNotNull(providers.payoutsReadyAt)))
      return
    }
    const [p] = await o.update(providers).set({ payoutsReadyAt: now }).where(and(byAccount, isNull(providers.payoutsReadyAt))).returning({ id: providers.id, ownerId: providers.ownerId, slug: providers.slug })
    if (!p) return
    const watchers = await o
      .update(availabilityWatches)
      .set({ notifiedAt: now })
      .where(and(eq(availabilityWatches.providerId, p.id), isNull(availabilityWatches.notifiedAt)))
      .returning({ customerId: availabilityWatches.customerId })
    after.push(() => notifyBookingEvent('payout-setup-complete', p.ownerId, {}))
    for (const w of watchers) after.push(() => notifyBookingEvent('provider-available', w.customerId, p.slug ? { slug: p.slug } : {}))
  })
  for (const fn of after) await fn() // notifyBookingEvent never throws
}
