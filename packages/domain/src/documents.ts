import { randomUUID } from 'node:crypto'
import { and, desc, eq, sql } from 'drizzle-orm'
import { documents, privateFiles, type Tx } from '@kando/db'
import type { Document } from '@kando/contract'
import { fail } from './providers/http'
import { lockProfile } from './providers/profile'
import { documentsBucket, storage } from './storage'

export const MAX_DOCUMENT_BYTES = 4_500_000
export const REQUIREMENTS = ['police-certificate', 'permit']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Reads and checks the PDF (by its leading bytes, not the declared type). Runs before the transaction. */
export async function preparePdf(request: Request): Promise<Buffer> {
  const form = await request.formData().catch(() => new FormData())
  const file = form.get('file')
  if (!(file instanceof File)) return fail(400, { error: 'Missing file' })
  if (file.size > MAX_DOCUMENT_BYTES) return fail(413, { error: 'File too large' })
  const bytes = Buffer.from(await file.arrayBuffer())
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') return fail(400, { error: 'Unsupported file type' })
  return bytes
}

/** Stores the PDF in the private bucket (object first; a failed insert removes it). */
export async function uploadFile(tx: Tx, userId: string, pdf: Buffer): Promise<{ id: string }> {
  const key = `documents/${userId}/${randomUUID()}.pdf`
  await storage().put(documentsBucket(), key, pdf, 'application/pdf')
  try {
    const [row] = await tx.insert(privateFiles).values({ ownerId: userId, key }).returning({ id: privateFiles.id })
    return { id: row!.id }
  } catch (e) {
    await storage().delete(documentsBucket(), key).catch(() => {})
    throw e
  }
}

/** A short-lived link to the caller's own file (uploaded or submitted); null when it is not theirs. */
export async function fileLink(tx: Tx, userId: string, id: string): Promise<string | null> {
  if (!UUID.test(id)) return null
  const key =
    (await tx.select({ key: privateFiles.key }).from(privateFiles).where(and(eq(privateFiles.id, id), eq(privateFiles.ownerId, userId))))[0]?.key ??
    (await tx.select({ key: documents.key }).from(documents).where(and(eq(documents.id, id), eq(documents.ownerId, userId))))[0]?.key
  return key ? storage().getSignedUrl(documentsBucket(), key, 300) : null
}

/** Deletes an uploaded file that no check uses yet; false when it is not the caller's. */
export async function deleteFile(tx: Tx, userId: string, id: string): Promise<boolean> {
  const row = UUID.test(id)
    ? (await tx.delete(privateFiles).where(and(eq(privateFiles.id, id), eq(privateFiles.ownerId, userId))).returning({ key: privateFiles.key }))[0]
    : undefined
  if (!row) return false
  await storage().delete(documentsBucket(), row.key).catch(() => {})
  return true
}

type Row = typeof documents.$inferSelect
const toDocument = (r: Row): Document => ({
  id: r.id,
  requirement: r.requirement,
  status: r.status as Document['status'],
  note: r.note,
  reviewedAt: r.reviewedAt?.toISOString() ?? null,
  createdAt: r.createdAt.toISOString(),
})

export async function listDocuments(tx: Tx, userId: string): Promise<Document[]> {
  const rows = await tx.select().from(documents).where(eq(documents.ownerId, userId)).orderBy(desc(documents.createdAt), desc(documents.id))
  return rows.map(toDocument)
}

/**
 * Opens a check for an uploaded file. 400 for an unknown requirement or file; 409 when a check for it is already
 * pending: then the file is removed (that answer is returned, not thrown, so the removal commits).
 */
export async function submitDocument(tx: Tx, userId: string, requirement: string, fileId: string): Promise<Response | Document> {
  if (!REQUIREMENTS.includes(requirement)) return fail(400, { error: 'Invalid requirement' })
  await lockProfile(tx, userId) // per user: a double tap cannot pass the pending check twice
  const file = UUID.test(fileId)
    ? (await tx.select().from(privateFiles).where(and(eq(privateFiles.id, fileId), eq(privateFiles.ownerId, userId))))[0]
    : undefined
  if (!file) return fail(400, { error: 'Invalid document' })
  const pending = await tx
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.ownerId, userId), eq(documents.requirement, requirement), eq(documents.status, 'pending')))
  if (pending.length) {
    await tx.delete(privateFiles).where(eq(privateFiles.id, file.id))
    await storage().delete(documentsBucket(), file.key).catch(() => {})
    return Response.json({ error: 'Check already pending' }, { status: 409 })
  }
  // Raw SQL naming only the owner's columns: the verdict columns are staff-only (a Drizzle insert lists them as DEFAULT).
  const { rows } = await tx.execute<{ id: string }>(
    sql`INSERT INTO documents (owner_id, requirement, key) VALUES (${userId}, ${requirement}, ${file.key}) RETURNING id`,
  )
  const doc = (await tx.select().from(documents).where(eq(documents.id, rows[0]!.id)))[0]!
  await tx.delete(privateFiles).where(eq(privateFiles.id, file.id)) // the object stays: the document owns it now
  return toDocument(doc)
}
