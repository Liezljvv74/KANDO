import { randomUUID } from 'node:crypto'
import { and, asc, eq, sql } from 'drizzle-orm'
import sharp from 'sharp'
import { photos, type Tx } from '@kando/db'
import type { Photo } from '@kando/contract'
import { fail } from './providers/http'
import { lockProfile, ownProvider } from './providers/profile'
import type { AfterCommit } from './app-request'
import { mediaBucket, photoUrl, removeObject, storage } from './storage'

export const MAX_PORTFOLIO_PHOTOS = 12
export const MAX_PHOTO_BYTES = 10_000_000
const MAX_PIXELS = 40_000_000 // decompression-bomb cap, above any phone camera
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type PreparedPhoto = { kind: 'profile' | 'portfolio'; alt: string | null; data: Buffer; width: number; height: number }

/**
 * Validates the multipart form and re-encodes the image to JPEG, at most 1600 px (drops EXIF incl. GPS).
 * Runs before the transaction. 400 on anything that is not a decodable jpeg, png or webp.
 */
export async function preparePhoto(request: Request): Promise<PreparedPhoto> {
  const form = await request.formData().catch(() => new FormData())
  const file = form.get('file')
  const kind = form.get('kind')
  const alt = form.get('alt') ?? ''
  if (!(file instanceof File)) return fail(400, { error: 'Missing file' })
  if (kind !== 'profile' && kind !== 'portfolio') return fail(400, { error: 'Invalid kind' })
  if (typeof alt !== 'string' || alt.length > 200) return fail(400, { error: 'Invalid alt' })
  if (file.size > MAX_PHOTO_BYTES) return fail(413, { error: 'File too large' })
  const bytes = Buffer.from(await file.arrayBuffer())
  try {
    const img = sharp(bytes, { limitInputPixels: MAX_PIXELS })
    if (!['jpeg', 'png', 'webp'].includes((await img.metadata()).format ?? '')) throw new Error('format')
    const out = await img
      .rotate()
      .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer({ resolveWithObject: true })
    return { kind, alt: alt || null, data: out.data, width: out.info.width, height: out.info.height }
  } catch {
    return fail(400, { error: 'Unsupported file type' })
  }
}

type Row = typeof photos.$inferSelect
const toPhoto = (r: Row): Photo & { width: number; height: number } => ({
  id: r.id,
  kind: r.kind === 'profile' ? 'profile' : 'portfolio',
  url: photoUrl(r.key),
  alt: r.alt,
  width: r.width,
  height: r.height,
})

export async function listPhotos(tx: Tx, userId: string): Promise<Photo[]> {
  const rows = await tx.select().from(photos).where(eq(photos.ownerId, userId)).orderBy(asc(photos.createdAt), asc(photos.id))
  return rows.map(toPhoto)
}

/** Stores the photo (object first, then the row; a failed insert removes the object). A profile photo replaces the old one. */
export async function addPhoto(tx: Tx, userId: string, p: PreparedPhoto, afterCommit: AfterCommit) {
  await lockProfile(tx, userId)
  const profile = await ownProvider(tx, userId)
  if (p.kind === 'portfolio') {
    if (!profile) return fail(409, { error: 'Create your profile first' })
    const n = (
      await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(photos)
        .where(and(eq(photos.ownerId, userId), eq(photos.kind, 'portfolio')))
    )[0]!.n
    if (n >= MAX_PORTFOLIO_PHOTOS) return fail(409, { error: 'Photo limit reached' })
  }
  const key = p.kind === 'profile' ? `users/${userId}/${randomUUID()}.jpg` : `providers/${profile!.id}/${randomUUID()}.jpg`
  await storage().put(mediaBucket(), key, p.data, 'image/jpeg')
  try {
    if (p.kind === 'profile') {
      // One picture per person (unique index): the old one goes first, its object only once the new photo is committed.
      const old = await tx
        .delete(photos)
        .where(and(eq(photos.ownerId, userId), eq(photos.kind, 'profile')))
        .returning({ key: photos.key })
      for (const o of old) afterCommit(() => removeObject(mediaBucket(), o.key))
    }
    const [row] = await tx
      .insert(photos)
      .values({ ownerId: userId, providerId: p.kind === 'profile' ? null : profile!.id, kind: p.kind, key, width: p.width, height: p.height, alt: p.alt })
      .returning()
    return toPhoto(row!)
  } catch (e) {
    await removeObject(mediaBucket(), key)
    throw e
  }
}

/** Deletes one of the caller's photos; false when it is not theirs. 409 for the profile photo of a published profile. */
export async function deletePhoto(tx: Tx, userId: string, id: string, afterCommit: AfterCommit): Promise<boolean> {
  await lockProfile(tx, userId) // serialises with publish
  const row = UUID.test(id)
    ? (await tx.select().from(photos).where(and(eq(photos.id, id), eq(photos.ownerId, userId))))[0]
    : undefined
  if (!row) return false
  const profile = await ownProvider(tx, userId)
  if (profile?.status === 'published' && row.kind === 'profile') fail(409, { error: 'Profile photo required while published' })
  await tx.delete(photos).where(eq(photos.id, id))
  afterCommit(() => removeObject(mediaBucket(), row.key))
  return true
}
