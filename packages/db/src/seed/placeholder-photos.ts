import { and, eq, isNull } from 'drizzle-orm'
import sharp from 'sharp'
import { addPhoto } from '@kando/domain'
import { asUser } from '../as-user'
import { db } from '../client'
import { providers } from '../schema'

const COLOURS = ['#2f6f8f', '#8f4f2f', '#4f8f5f', '#7a4f8f', '#8f7a2f', '#2f4f8f', '#8f2f5f', '#3f7f7f']
const esc = (s: string) => s.replace(/[&<>]/g, (c) => `&#${c.charCodeAt(0)};`)

/** A coloured square (palette picked by a hash of the name) with the initials in white; JPEG, 512 px. */
export function placeholderJpeg(name: string): Promise<{ data: Buffer; width: number; height: number }> {
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => Array.from(w)[0]!.toUpperCase()).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
<rect width="512" height="512" fill="${COLOURS[hash % COLOURS.length]}"/>
<text x="256" y="256" font-family="Arial, Helvetica, sans-serif" font-size="200" font-weight="bold" fill="#fff" text-anchor="middle" dominant-baseline="central">${esc(initials)}</text>
</svg>`
  return sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer({ resolveWithObject: true }).then((o) => ({ data: o.data, width: o.info.width, height: o.info.height }))
}

/** Adds a generated profile photo for one owner through the domain path (storage object, row, set_provider_photo). */
export async function givePlaceholderPhoto(userId: string, name: string): Promise<void> {
  const img = await placeholderJpeg(name)
  const after: (() => Promise<void>)[] = []
  await asUser(userId, (tx) => addPhoto(tx, userId, { kind: 'profile', alt: name, ...img }, (fn) => void after.push(fn)))
  for (const fn of after) await fn()
}

/** Gives every published profile without a photo one; returns how many it added. */
export async function addPlaceholderPhotos(): Promise<number> {
  const rows = await db
    .select({ owner: providers.ownerId, name: providers.publicName, display: providers.displayName })
    .from(providers)
    .where(and(eq(providers.status, 'published'), isNull(providers.photoId)))
  for (const r of rows) {
    await givePlaceholderPhoto(r.owner, r.name ?? r.display)
  }
  return rows.length
}

export const isDevBranch = (branch: string | undefined) => branch === 'kando-dev' || branch === 'dev'

/** Dev branch: go ahead. Anywhere else: ALLOW_PRODUCTION=1 and a typed "yes" from `ask`. */
export async function confirmedOrDev(
  branch: string | undefined,
  env: Record<string, string | undefined>,
  ask: () => Promise<string>,
): Promise<void> {
  if (isDevBranch(branch)) return
  if (env.ALLOW_PRODUCTION !== '1') throw new Error('Not the dev branch: set ALLOW_PRODUCTION=1 to run here')
  if ((await ask()).trim() !== 'yes') throw new Error('Cancelled')
}
