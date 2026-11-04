import { termsCurrent } from '../users'
import { and, count, eq, gt, gte, isNull, lt, lte, ne, or, sql, sum } from 'drizzle-orm'
import { db, documentAiChecks, documents, providers, users } from '@kando/db'
import { describeError } from '../log-error'
import { notifyDocumentDecision } from '../notifications'
import { documentsBucket, storage } from '../storage'
import { AiUnavailable, FALLBACK_COST_PER_CALL, openRouterChecker, type DocumentChecker, type ModelOpts } from './openrouter'
import { minConfidence, monthlyCapEur, providerPin, stripPersonalData, TYPE_NAME, wouldAutoApprove } from './rules'

export { DEFAULT_MIN_CONFIDENCE, DEFAULT_MONTHLY_CAP_EUR, minConfidence, monthlyCapEur, stripPersonalData, wouldAutoApprove } from './rules'

/** The `failure` value of the cost row an ID scan leaves (no document; counted in the monthly cap, not in the document-check hourly limit). */
export const ID_SCAN_FAILURE = 'id-scan'
/** The requirement code of a photo ID: its image is kept only 30 days after the check. */
export const ID_DOCUMENT = 'id-document'
export const ID_IMAGE_KEEP_DAYS = 30
/** Share of AI-approved documents a person looks at anyway (the same for every document type). Drawn after the AI decided. */
export const SPOT_CHECK_RATE = 0.1
/** Checks per provider and hour: an upload loop must not run up the bill. */
export const CHECKS_PER_HOUR = 10
// Used only when OpenRouter does not report the cost of a call.
const FALLBACK_EUR_PER_TOKEN = 0.00002
const FALLBACK_EUR_PER_CALL = FALLBACK_COST_PER_CALL

const MIME: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }

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
  const o = modelOptsFromEnv()
  return o ? openRouterChecker(o) : null
}

/** The model settings from the environment (also used by the ID scan), or null when the AI is off. */
export function modelOptsFromEnv(): ModelOpts | null {
  const apiKey = process.env.OPENROUTER_API_KEY
  const model = process.env.AI_DOCUMENT_MODEL?.trim()
  const provider = providerPin()
  if (provider === false) return null // a mistyped pin switches the AI off, never widens where documents go
  return apiKey && model ? { apiKey, model, provider } : null
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
    console.error(`[ai-check] document ${documentId} failed ${describeError(e)}`)
    // A row claimed before the failure must not stay undecided without a reason: staff see why. Best effort; the document is pending either way.
    await db.update(documentAiChecks).set({ failure: 'error', decision: 'sent-to-staff', finishedAt: sql`now()` }).where(and(eq(documentAiChecks.documentId, documentId), isNull(documentAiChecks.decision))).catch(() => {})
    return 'skipped'
  }
}

async function check(documentId: string, checker: DocumentChecker, deps: CheckDeps): Promise<CheckOutcome> {
  const now = deps.now ?? new Date()
  const [doc] = await db
    .select({ id: documents.id, ownerId: documents.ownerId, requirement: documents.requirement, key: documents.key, status: documents.status, imageDeletedAt: documents.imageDeletedAt, firstName: users.firstName, lastName: users.lastName, termsAcceptedAt: users.termsAcceptedAt, termsVersion: users.termsVersion, business: providers.businessName })
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

  // The only AI disclosure is in the terms accepted at sign-up: without a current acceptance (an older account, or terms that changed since) nothing is sent.
  if (!termsCurrent(doc)) return toStaff({ failure: 'terms-not-accepted' })
  const person = [doc.firstName, doc.lastName].filter(Boolean).join(' ').trim()
  // A photo ID must carry the person's own name; the business name counts only for the other documents.
  const names = (doc.requirement === ID_DOCUMENT ? [person] : [person, (doc.business ?? '').trim()]).filter(Boolean)
  if (!names.length) return toStaff({ failure: 'no-name' })

  const hourAgo = new Date(now.getTime() - 3_600_000)
  const [recentRow] = await db
    .select({ n: count() })
    .from(documentAiChecks)
    // ID scans have their own hourly count (the cost rows are shared, the limits are not): ten scans must not send documents to staff.
    .where(and(eq(documentAiChecks.ownerId, doc.ownerId), gt(documentAiChecks.createdAt, hourAgo), ne(documentAiChecks.id, claim.id), or(isNull(documentAiChecks.failure), ne(documentAiChecks.failure, ID_SCAN_FAILURE))))
  if ((recentRow?.n ?? 0) >= CHECKS_PER_HOUR) return toStaff({ failure: 'rate-limit' })

  // ponytail: concurrent checks can overshoot the hourly limit and the cap by a few calls (check, then act); a lock would only be needed at much higher volume.
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const [spentRow] = await db.select({ spent: sum(documentAiChecks.costEur) }).from(documentAiChecks).where(gte(documentAiChecks.createdAt, monthStart))
  if (Number(spentRow?.spent ?? 0) >= monthlyCapEur()) return toStaff({ failure: 'cap' })

  let out
  try {
    const ext = doc.key.includes('.') ? doc.key.split('.').pop()!.toLowerCase() : ''
    out = await checker.check({
      bytes: await storage().get(documentsBucket(), doc.key),
      mime: MIME[ext] ?? 'application/octet-stream',
      documentType: TYPE_NAME[doc.requirement] ?? doc.requirement,
      names,
      today: now.toISOString().slice(0, 10),
    })
  } catch (e) {
    const timeout = e instanceof AiUnavailable && e.reason === 'timeout'
    // A timeout may still have been billed; so was an answer that came back unusable (it carries its cost). A refusal or network error was not.
    const costEur = e instanceof AiUnavailable && e.costUsd !== null ? e.costUsd : timeout ? FALLBACK_EUR_PER_CALL : 0
    return toStaff({ failure: timeout ? 'timeout' : 'error', costEur })
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
  // The approval is committed: a failing email or push must not skip refreshing the public pages.
  await notifyDocumentDecision(doc.ownerId, { id: documentId, requirement: doc.requirement, status: 'approved', note: null }).catch((e) => console.error(`[ai-check] document ${documentId} notice failed ${describeError(e)}`))
  deps.afterApproved?.()
  return 'auto-approved'
}

/**
 * A check whose function was killed mid-way (the 60 second limit, a deploy) leaves its row undecided for good: the unique row per
 * document blocks a retry, and the call may already have been billed. Rows older than ten minutes without a decision are closed as
 * 'interrupted' and sent to staff, with at least the fallback cost booked (errs safe for the cap). The document was pending all along.
 */
export async function closeInterruptedChecks(now: Date = new Date()): Promise<number> {
  const stale = new Date(now.getTime() - 10 * 60_000)
  const rows = await db
    .update(documentAiChecks)
    .set({ failure: 'interrupted', decision: 'sent-to-staff', finishedAt: sql`now()`, costEur: sql`greatest(${documentAiChecks.costEur}, ${FALLBACK_EUR_PER_CALL})` })
    .where(and(isNull(documentAiChecks.decision), lt(documentAiChecks.createdAt, stale)))
    .returning({ id: documentAiChecks.id })
  return rows.length
}

/**
 * The daily clean-up of photo ID images: 30 days after the AI check finished (as the terms say; a person's later decision does not
 * move the date, and a document still waiting for staff is included) the object is deleted and the row marked. Only documents the AI checked, so with the feature off nothing
 * changes. A failing delete leaves the row for tomorrow. Owner connection. Returns how many images went.
 */
export async function sweepIdImages(now: Date = new Date(), limit = 100): Promise<number> {
  const before = new Date(now.getTime() - ID_IMAGE_KEEP_DAYS * 86_400_000)
  const due = await db
    .select({ id: documents.id, key: documents.key })
    .from(documents)
    .innerJoin(documentAiChecks, eq(documentAiChecks.documentId, documents.id))
    .where(and(eq(documents.requirement, ID_DOCUMENT), isNull(documents.imageDeletedAt), lte(sql`coalesce(${documentAiChecks.finishedAt}, ${documentAiChecks.createdAt})`, before)))
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
