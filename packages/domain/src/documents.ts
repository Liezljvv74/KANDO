import { randomUUID } from 'node:crypto'
import { and, desc, eq, ne, sql } from 'drizzle-orm'
import sharp from 'sharp'
import { db, documents, pendingObjectDeletes, privateFiles, type Tx } from '@kando/db'
import type { Document } from '@kando/contract'
import { flushPendingObjects } from './account'
import { fail } from './providers/http'
import { lockProfile } from './providers/profile'
import type { AfterCommit } from './app-request'
import { documentsBucket, removeObject, storage } from './storage'

export const MAX_DOCUMENT_BYTES = 4_500_000
export const MAX_PENDING_UPLOADS = 10
export const REQUIREMENTS = ['police-certificate', 'permit']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const MAX_PIXELS = 40_000_000 // decompression-bomb cap, as for photos
const MAX_SIDE = 2400
const IMAGE: Record<string, { type: string; ext: string }> = {
  jpeg: { type: 'image/jpeg', ext: 'jpg' },
  png: { type: 'image/png', ext: 'png' },
  webp: { type: 'image/webp', ext: 'webp' },
}

export type PreparedDocument = { data: Buffer; type: string; ext: string }

/**
 * Reads and checks the document by its leading bytes, never the declared type or name: a PDF is kept as is; a JPEG,
 * PNG or WEBP (a scan or a photo of a certificate) is turned upright, re-encoded in its own format at most 2400 px,
 * without metadata (EXIF, GPS). Anything else is 400. Runs before the transaction.
 */
export async function prepareDocument(request: Request): Promise<PreparedDocument> {
  const form = await request.formData().catch(() => new FormData())
  const file = form.get('file')
  if (!(file instanceof File)) return fail(400, { error: 'Missing file' })
  if (file.size > MAX_DOCUMENT_BYTES) return fail(413, { error: 'File too large' })
  const bytes = Buffer.from(await file.arrayBuffer())
  if (bytes.subarray(0, 5).toString('latin1') === '%PDF-') return { data: bytes, type: 'application/pdf', ext: 'pdf' }
  try {
    const img = sharp(bytes, { limitInputPixels: MAX_PIXELS }) // sharp tells the format from the leading bytes
    const format = (await img.metadata()).format ?? ''
    if (!IMAGE[format]) throw new Error('format')
    const data = await img
      .rotate()
      .resize(MAX_SIDE, MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
      .toFormat(format as keyof sharp.FormatEnum)
      .toBuffer()
    return { data, ...IMAGE[format] }
  } catch {
    return fail(400, { error: 'Unsupported file type' })
  }
}

/** Stores the document in the private bucket with its own type (object first; a failed insert removes it). */
export async function uploadFile(tx: Tx, userId: string, doc: PreparedDocument): Promise<{ id: string }> {
  await lockProfile(tx, userId) // per user: concurrent uploads cannot pass the cap together
  const pending = (await tx.select({ n: sql<number>`count(*)::int` }).from(privateFiles).where(eq(privateFiles.ownerId, userId)))[0]!.n
  if (pending >= MAX_PENDING_UPLOADS) return fail(409, { error: 'Too many pending uploads' })
  const key = `documents/${userId}/${randomUUID()}.${doc.ext}`
  await storage().put(documentsBucket(), key, doc.data, doc.type)
  try {
    const [row] = await tx.insert(privateFiles).values({ ownerId: userId, key }).returning({ id: privateFiles.id })
    return { id: row!.id }
  } catch (e) {
    await removeObject(documentsBucket(), key)
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
export async function deleteFile(tx: Tx, userId: string, id: string, afterCommit: AfterCommit): Promise<boolean> {
  const row = UUID.test(id)
    ? (await tx.delete(privateFiles).where(and(eq(privateFiles.id, id), eq(privateFiles.ownerId, userId))).returning({ key: privateFiles.key }))[0]
    : undefined
  if (!row) return false
  afterCommit(() => removeObject(documentsBucket(), row.key))
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
export async function submitDocument(tx: Tx, userId: string, requirement: string, fileId: string, afterCommit: AfterCommit): Promise<Response | Document> {
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
    afterCommit(() => removeObject(documentsBucket(), file.key))
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

/**
 * Deletes one of the caller's submitted documents, but only while another document for the same requirement exists (any
 * status, pending included): false when it is not theirs (404), 409 REPLACEMENT_FIRST otherwise. Runs on the owner connection
 * with an explicit owner filter, so the row, its owed object delete and the check happen in one transaction; the person's
 * documents of that requirement are locked first, so two deletes at once cannot remove both. The object goes after the commit
 * (a failure leaves the owed row for the daily job). Eligibility follows from the rows: a service that needed the deleted,
 * approved document goes offline until the replacement is approved.
 */
export async function deleteDocument(userId: string, id: string, afterCommit: AfterCommit): Promise<boolean> {
  if (!UUID.test(id)) return false
  const owed = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(documents).where(and(eq(documents.id, id), eq(documents.ownerId, userId)))
    if (!row) return null
    await tx.execute(sql`SELECT id FROM documents WHERE owner_id = ${userId} AND requirement = ${row.requirement} ORDER BY id FOR UPDATE`)
    const [other] = await tx.select({ id: documents.id }).from(documents).where(and(eq(documents.ownerId, userId), eq(documents.requirement, row.requirement), ne(documents.id, id)))
    if (!other) return fail(409, { error: 'REPLACEMENT_FIRST' })
    const gone = await tx.delete(documents).where(and(eq(documents.id, id), eq(documents.ownerId, userId))).returning({ id: documents.id })
    if (!gone.length) return null // deleted meanwhile
    const [t] = await tx.insert(pendingObjectDeletes).values({ bucket: documentsBucket(), key: row.key }).returning({ id: pendingObjectDeletes.id })
    return t!.id
  })
  if (!owed) return false
  afterCommit(async () => void (await flushPendingObjects([owed])))
  return true
}
