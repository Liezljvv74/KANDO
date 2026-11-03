import { and, count, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { documentAiChecks, documents, users, type Tx } from '@kando/db'
import type { AdminListQuery, DocumentReviewInput } from '@kando/contract'
import type { AfterCommit } from '../app-request'
import { notifyDocumentDecision } from '../notifications'
import { fail } from '../providers/http'
import { documentsBucket, storage } from '../storage'
import type { StaffUser } from '../users'
import { filterOf, isUuid, like, notFound, ok, pageOf, textOf } from './common'

const cols = {
  id: documents.id,
  ownerId: documents.ownerId,
  ownerEmail: users.email,
  requirement: documents.requirement,
  status: documents.status,
  note: documents.note,
  reviewedBy: documents.reviewedBy,
  reviewedAt: documents.reviewedAt,
  createdAt: documents.createdAt,
}
const dto = (r: { reviewedAt: Date | null; createdAt: Date }) => ({ ...r, reviewedAt: r.reviewedAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString() })

/** Pending checks first (oldest first), then the decided ones, newest first. */
export async function listDocuments(tx: Tx, q: AdminListQuery) {
  const f = filterOf(q)
  const text = textOf(f.q)
  const where = and(
    textOf(f.status) ? eq(documents.status, textOf(f.status)!) : undefined,
    text ? or(ilike(users.email, like(text)), ilike(documents.requirement, like(text))) : undefined,
  )
  const total = (await tx.select({ n: count() }).from(documents).innerJoin(users, eq(users.id, documents.ownerId)).where(where))[0]!.n
  const rows = await tx
    .select(cols)
    .from(documents)
    .innerJoin(users, eq(users.id, documents.ownerId))
    .where(where)
    .orderBy(sql`(${documents.status} <> 'pending')`, sql`CASE WHEN ${documents.status} = 'pending' THEN ${documents.createdAt} END ASC`, desc(documents.createdAt))
    .limit(pageOf(q).limit)
    .offset(pageOf(q).offset)
  return ok(rows.map(dto), total)
}

/**
 * One document with a short-lived link to the file in the private bucket (null once a photo ID image was deleted, `imageDeletedAt` says when)
 * and the AI's suggestion, when there is one. Staff only: the explanation is shown here and nowhere else.
 */
export async function getDocument(tx: Tx, id: string) {
  const row = isUuid(id)
    ? (
        await tx
          .select({ ...cols, key: documents.key, imageDeletedAt: documents.imageDeletedAt, ai: documentAiChecks })
          .from(documents)
          .innerJoin(users, eq(users.id, documents.ownerId))
          .leftJoin(documentAiChecks, eq(documentAiChecks.documentId, documents.id))
          .where(eq(documents.id, id))
      )[0]
    : undefined
  if (!row) return notFound()
  const { key, imageDeletedAt, ai, ...rest } = row
  return ok({
    ...dto(rest),
    link: imageDeletedAt ? null : await storage().getSignedUrl(documentsBucket(), key, 300),
    imageDeletedAt: imageDeletedAt?.toISOString() ?? null,
    ai: ai && { verdict: ai.verdict, confidence: ai.confidence, explanation: ai.explanation, sampled: ai.sampled, decision: ai.decision, failure: ai.failure, model: ai.model, staffDecision: ai.staffDecision, finishedAt: ai.finishedAt?.toISOString() ?? null },
  })
}

/** Approves or rejects a pending document; the owner is told once the decision has committed. */
export async function reviewDocument(tx: Tx, staff: StaffUser, id: string, input: DocumentReviewInput, afterCommit: AfterCommit) {
  if (!isUuid(id)) return notFound()
  const [row] = await tx.select().from(documents).where(eq(documents.id, id)).for('update')
  if (!row) return notFound()
  if (row.ownerId === staff.id) return fail(403, { error: 'You cannot review your own document' })
  if (row.status !== 'pending') return fail(409, { error: 'Already decided' })
  const note = input.note || null
  if (input.decision === 'rejected' && !note) return fail(400, { error: 'A reason is required' })
  const [done] = await tx
    .update(documents)
    .set({ status: input.decision, note, reviewedBy: staff.id, reviewedAt: sql`now()` })
    .where(eq(documents.id, id))
    .returning()
  // The decision is logged next to the AI's suggestion (who decided is documents.reviewed_by), to compare them later.
  await tx.update(documentAiChecks).set({ staffDecision: input.decision }).where(eq(documentAiChecks.documentId, id))
  afterCommit(() => notifyDocumentDecision(done!.ownerId, { id, requirement: done!.requirement, status: input.decision, note }))
  return getDocument(tx, id)
}
