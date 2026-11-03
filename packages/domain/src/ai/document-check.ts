import { and, count, eq, gt, gte, isNull, lte, ne, sql, sum } from 'drizzle-orm'
import { db, documentAiChecks, documents, providers, users } from '@kando/db'
import { describeError } from '../log-error'
import { notifyDocumentDecision } from '../notifications'
import { documentsBucket, storage } from '../storage'
import { AiUnavailable, openRouterChecker, type DocumentChecker } from './openrouter'
import { minConfidence, monthlyCapEur, providerPin, stripPersonalData, TYPE_NAME, wouldAutoApprove } from './rules'

export { DEFAULT_MIN_CONFIDENCE, DEFAULT_MONTHLY_CAP_EUR, minConfidence, monthlyCapEur, stripPersonalData, wouldAutoApprove } from './rules'

/** The requirement code of a photo ID: its image is kept only 30 days after the check. */
export const ID_DOCUMENT = 'id-document'
export const ID_IMAGE_KEEP_DAYS = 30
/** Share of AI-approved documents a person looks at anyway (the same for every document type). Drawn after the AI decided. */
export const SPOT_CHECK_RATE = 0.1
/** Checks per provider and hour: an upload loop must not run up the bill. */
export const CHECKS_PER_HOUR = 10
// Used only when OpenRouter does not report the cost of a call.
const FALLBACK_EUR_PER_TOKEN = 0.00002
const FALLBACK_EUR_PER_CALL = 0.02

const MIME: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }

let override: DocumentChecker | undefined
/** Test hook (via '@kando/domain/src/testing'): a fake model client. Setting it also switches the feature on. */
export const setDocumentCheckerForTests = (c: DocumentChecker | undefined) => {
  override = c
}

/**
 * The model client, or null when the feature is off. It is on only when OPENROUTER_API_KEY and AI_DOCUMENT_MODEL are both set.
 * The key alone is not enough: the translate button uses the same key, and no document may go to a model the owner has not chosen.
 */
export function documentChecker(): DocumentChecker | null {
  if (override) return override
  const apiKey = process.env.OPENROUTER_API_KEY
  const model = process.env.AI_DOCUMENT_MODEL?.trim()
  const provider = providerPin()
  if (provider === false) return null // a mistyped pin switches the check off, never widens where documents go
  return apiKey && model ? openRouterChecker({ apiKey, model, provider }) : null
}

export type CheckDeps = {
  checker?: DocumentChecker
  /** 0 to 1; tests inject it. */
  random?: () => number
  now?: Date
  /** Runs after the AI approved a document (the web app refreshes its public pages). */
  afterApproved?: () => void
}
export type CheckOutcome = 'off' | 'skipped' | 'auto-approved' | 'sent-to-staff'

/**
 * The AI check of one just-submitted document, run after the response (never inside the upload). Owner connection: the results
 * table is staff-only. Idempotent: the unique row per document is the claim, so a second run does nothing. Everything that is not a
 * clear "ok" leaves the document pending for staff, exactly as without AI: a problem, low confidence, the spot check, a failing or
 * slow provider, the rate limit and the monthly cap. Never throws; logs only the document id and the outcome, no content.
 */
export async function runDocumentCheck(documentId: string, deps: CheckDeps = {}): Promise<CheckOutcome> {
  const checker = deps.checker ?? documentChecker()
  if (!checker) return 'off'
  try {
    return await check(documentId, checker, deps)
  } catch (e) {
    console.error(`[ai-check] document ${documentId} failed ${describeError(e)}`) // the claimed row stays undecided: staff decide
    return 'skipped'
  }
}

async function check(documentId: string, checker: DocumentChecker, deps: CheckDeps): Promise<CheckOutcome> {
  const now = deps.now ?? new Date()
  const [doc] = await db
    .select({ id: documents.id, ownerId: documents.ownerId, requirement: documents.requirement, key: documents.key, status: documents.status, imageDeletedAt: documents.imageDeletedAt, firstName: users.firstName, lastName: users.lastName, business: providers.businessName })
    .from(documents)
    .innerJoin(users, eq(users.id, documents.ownerId))
    .leftJoin(providers, eq(providers.ownerId, documents.ownerId))
    .where(eq(documents.id, documentId))
  if (!doc || doc.status !== 'pending' || doc.imageDeletedAt) return 'skipped'
  const [claim] = await db.insert(documentAiChecks).values({ documentId, ownerId: doc.ownerId, model: checker.model }).onConflictDoNothing().returning({ id: documentAiChecks.id })
  if (!claim) return 'skipped' // already checked or being checked

  const toStaff = async (patch: { failure?: string; verdict?: string; confidence?: number; explanation?: string | null; sampled?: boolean; costEur?: number }): Promise<CheckOutcome> => {
    await db.update(documentAiChecks).set({ ...patch, costEur: patch.costEur === undefined ? undefined : patch.costEur.toFixed(6), decision: 'sent-to-staff', finishedAt: sql`now()` }).where(eq(documentAiChecks.id, claim.id))
    console.log(JSON.stringify({ event: 'ai-document-check', documentId, verdict: patch.verdict ?? null, decision: 'sent-to-staff', failure: patch.failure ?? null }))
    return 'sent-to-staff'
  }

  const person = [doc.firstName, doc.lastName].filter(Boolean).join(' ').trim()
  // A photo ID must carry the person's own name; the business name counts only for the other documents.
  const names = (doc.requirement === ID_DOCUMENT ? [person] : [person, (doc.business ?? '').trim()]).filter(Boolean)
  if (!names.length) return toStaff({ failure: 'no-name' })

  const hourAgo = new Date(now.getTime() - 3_600_000)
  const [recentRow] = await db
    .select({ n: count() })
    .from(documentAiChecks)
    .where(and(eq(documentAiChecks.ownerId, doc.ownerId), gt(documentAiChecks.createdAt, hourAgo), ne(documentAiChecks.id, claim.id)))
  if ((recentRow?.n ?? 0) >= CHECKS_PER_HOUR) return toStaff({ failure: 'rate-limit' })

  // ponytail: concurrent checks can overshoot the cap by a few calls; a lock would only be needed at much higher volume.
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const [spentRow] = await db.select({ spent: sum(documentAiChecks.costEur) }).from(documentAiChecks).where(gte(documentAiChecks.createdAt, monthStart))
  if (Number(spentRow?.spent ?? 0) >= monthlyCapEur()) return toStaff({ failure: 'cap' })

  let out
  try {
    const ext = doc.key.split('.').pop() ?? ''
    out = await checker.check({
      bytes: await storage().get(documentsBucket(), doc.key),
      mime: MIME[ext] ?? 'application/octet-stream',
      documentType: TYPE_NAME[doc.requirement] ?? doc.requirement,
      names,
      today: now.toISOString().slice(0, 10),
    })
  } catch (e) {
    const timeout = e instanceof AiUnavailable && e.reason === 'timeout'
    return toStaff({ failure: timeout ? 'timeout' : 'error', costEur: timeout ? FALLBACK_EUR_PER_CALL : 0 })
  }

  const { result } = out
  const costEur = out.costUsd ?? (out.tokens ? out.tokens * FALLBACK_EUR_PER_TOKEN : FALLBACK_EUR_PER_CALL)
  const auto = wouldAutoApprove(result, minConfidence(), doc.requirement === ID_DOCUMENT)
  const sampled = auto && (deps.random ?? Math.random)() < SPOT_CHECK_RATE
  if (!auto || sampled) {
    // The "why not approved" text is kept only when the AI itself had a problem or doubt, never a content copy.
    const explanation = !auto ? stripPersonalData(result.reasons, [person, doc.business ?? '']) || null : null
    return toStaff({ verdict: result.verdict, confidence: result.confidence, explanation, sampled, costEur })
  }

  const approved = await db.transaction(async (tx) => {
    const [row] = await tx.select({ status: documents.status }).from(documents).where(eq(documents.id, documentId)).for('update')
    const still = row?.status === 'pending'
    if (still) await tx.update(documents).set({ status: 'approved', reviewedAt: sql`now()` }).where(eq(documents.id, documentId))
    await tx
      .update(documentAiChecks)
      .set({ verdict: result.verdict, confidence: result.confidence, costEur: costEur.toFixed(6), decision: still ? 'auto-approved' : 'sent-to-staff', failure: still ? null : 'staff-decided', finishedAt: sql`now()` })
      .where(eq(documentAiChecks.id, claim.id))
    return still
  })
  console.log(JSON.stringify({ event: 'ai-document-check', documentId, verdict: result.verdict, decision: approved ? 'auto-approved' : 'sent-to-staff' }))
  if (!approved) return 'sent-to-staff'
  await notifyDocumentDecision(doc.ownerId, { id: documentId, requirement: doc.requirement, status: 'approved', note: null })
  deps.afterApproved?.()
  return 'auto-approved'
}

/**
 * The daily clean-up of photo ID images: 30 days after the check is finished (the AI's decision, or the staff decision for a
 * document sent to staff) the object is deleted and the row marked. Only documents the AI checked, so with the feature off nothing
 * changes. A failing delete leaves the row for tomorrow. Owner connection. Returns how many images went.
 */
export async function sweepIdImages(now: Date = new Date(), limit = 100): Promise<number> {
  const before = new Date(now.getTime() - ID_IMAGE_KEEP_DAYS * 86_400_000)
  const due = await db
    .select({ id: documents.id, key: documents.key })
    .from(documents)
    .innerJoin(documentAiChecks, eq(documentAiChecks.documentId, documents.id))
    .where(and(eq(documents.requirement, ID_DOCUMENT), isNull(documents.imageDeletedAt), ne(documents.status, 'pending'), lte(sql`coalesce(${documents.reviewedAt}, ${documentAiChecks.finishedAt})`, before)))
    .limit(limit)
  let gone = 0
  for (const d of due) {
    try {
      await storage().delete(documentsBucket(), d.key) // deleting a missing object is not an error
      await db.update(documents).set({ imageDeletedAt: sql`now()` }).where(eq(documents.id, d.id))
      gone++
    } catch (e) {
      console.error(`[ai-check] could not delete the image of document ${d.id} ${describeError(e)}`)
    }
  }
  return gone
}
