import { and, eq, sql } from 'drizzle-orm'
import { categories, categoryTexts, db, documents, providers, services, users } from '@kando/db'
import { DEFAULT_LANG, isLang, LOCALE, TIME_ZONE, type Lang } from '@kando/i18n'
import { sendEmail, type Template } from './email'
import { describeError } from './log-error'
import { createNotification } from './notifications-store'
import { offerableServiceIds } from './providers/eligibility'
import { isSuspendedNow } from './providers/profile'

export const emailDate = (d: Date, lang: Lang) => d.toLocaleDateString(LOCALE[lang], { timeZone: TIME_ZONE })

/** A booking deadline: date and time in the platform time zone (a deadline at 04:00 or a 6-hour window needs the time). */
export const emailDateTime = (d: Date, lang: Lang) =>
  d.toLocaleString(LOCALE[lang], { timeZone: TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })

/** The website's address, no trailing slash. */
export function siteBase(): string {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL
  return (process.env.NEXT_PUBLIC_SERVER_URL || (host ? `https://${host}` : 'http://localhost:3000')).replace(/\/$/, '')
}

/** Public address of a provider page; the language only when it is not the default. */
export function providerUrl(slug: string, lang: Lang): string {
  return `${siteBase()}/providers/${slug}${lang !== DEFAULT_LANG ? `?lang=${lang}` : ''}`
}

/**
 * Stores the "profile is live" message unless one was stored since the latest approval (two reviewers deciding at the
 * same moment both find the profile complete). The advisory lock makes the check and the insert one step per user.
 */
async function claimProfileLive(userId: string, url: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`)
    const told = await tx.execute(sql`SELECT 1 FROM notifications WHERE user_id = ${userId} AND kind = 'profile-live'
      AND created_at >= coalesce((SELECT max(reviewed_at) FROM documents WHERE owner_id = ${userId} AND status = 'approved'), '-infinity')`)
    if (told.rows.length) return false
    await createNotification(tx, userId, 'profile-live', { url })
    return true
  })
}

/**
 * Which email an approval is: it says what actually happened to the profile. Runs after the approval committed, on the
 * owner connection. Only the first approval of a requirement changes anything for services; an offline or suspended
 * profile is never called live.
 */
async function decideApprovalEmail(userId: string, requirement: string, lang: Lang): Promise<{ template: Template; params: Record<string, string> }> {
  const plain = { template: 'document-approved' as const, params: { requirement } }
  const approved = (await db.select({ id: documents.id }).from(documents).where(and(eq(documents.ownerId, userId), eq(documents.requirement, requirement), eq(documents.status, 'approved')))).length
  const [provider] = await db.select().from(providers).where(eq(providers.ownerId, userId))
  if (approved > 1 || !provider) return plain // already approved before, or no services to show
  const mine = await db
    .select({ id: services.id, categoryId: services.categoryId, required: categories.requiredDocuments })
    .from(services)
    .innerJoin(categories, eq(categories.id, services.categoryId))
    .where(eq(services.providerId, provider.id))
  const affected = mine.filter((s) => s.required.includes(requirement))
  if (!affected.length) return plain
  if (provider.status !== 'published') return { template: 'document-approved-offline', params: {} }
  if (provider.suspendedUntil && (await isSuspendedNow(db, provider.id))) {
    return { template: 'document-approved-suspended', params: { date: emailDate(provider.suspendedUntil, lang) } }
  }
  const offerable = new Set(await offerableServiceIds(db, provider.id))
  const nowVisible = affected.find((s) => offerable.has(s.id))
  if (mine.some((s) => !offerable.has(s.id))) {
    if (!nowVisible) return plain // still hidden by another document: nothing became visible
    const names = await db.select({ lang: categoryTexts.lang, name: categoryTexts.name }).from(categoryTexts).where(eq(categoryTexts.categoryId, nowVisible.categoryId))
    const category = (names.find((n) => n.lang === lang) ?? names.find((n) => n.lang === DEFAULT_LANG))?.name ?? ''
    return { template: 'document-approved-visible', params: { category } }
  }
  const url = providerUrl(provider.slug!, lang)
  try {
    if (!(await claimProfileLive(userId, url))) return plain // a simultaneous approval already told them
  } catch (e) {
    // The email must still go out when the in-app message cannot be stored.
    console.error('[notify] profile-live notification failed', describeError(e))
  }
  return { template: 'profile-live', params: { url } }
}

/** What a staff decision on a document tells the owner. */
export type DocumentDecision = { id: string; requirement: string; status: 'approved' | 'rejected'; note: string | null }

export async function notifyDocumentDecision(userId: string, document: DocumentDecision): Promise<void> {
  try {
    const [user] = await db.select({ email: users.email, language: users.language }).from(users).where(eq(users.id, userId))
    if (!user) return
    const lang = isLang(user.language) ? user.language : DEFAULT_LANG
    const { template, params } =
      document.status === 'approved'
        ? await decideApprovalEmail(userId, document.requirement, lang)
        : { template: 'document-rejected' as const, params: { requirement: document.requirement, note: document.note } }
    await sendEmail({ to: user.email, lang, template, params })
  } catch (e) {
    // After commit: a failure here must never reach the request.
    console.error('[notify] document decision email failed', describeError(e))
  }
}

/** Tells the user their profile was suspended until `until` (with the reason), or, with null, that it is published again. */
export async function notifySuspension(userId: string, s: { until: Date | null; reason: string }): Promise<void> {
  try {
    const [user] = await db.select({ email: users.email, language: users.language }).from(users).where(eq(users.id, userId))
    if (!user) return
    const lang = isLang(user.language) ? user.language : DEFAULT_LANG
    await sendEmail({
      to: user.email,
      lang,
      template: s.until ? 'suspended' : 'published-again',
      params: { reason: s.reason, date: s.until && emailDate(s.until, lang) },
    })
  } catch (e) {
    console.error('[notify] suspension email failed', describeError(e))
  }
}
