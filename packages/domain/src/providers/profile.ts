import { and, eq, sql } from 'drizzle-orm'
import { lookupPostcode, photos, providers, services, users, type Tx } from '@kando/db'
import type { Missing, MyProfile, ProfileInput } from '@kando/contract'
import { fail } from './http'
import { publicNameFor } from './public-name'
import { slugify } from './slug'

type Row = typeof providers.$inferSelect

const toMyProfile = (r: Row, missing: Missing[]): MyProfile => ({
  id: r.id,
  publicName: r.publicName,
  providerType: r.type === null ? null : r.type === 'business' ? 'business' : 'individual',
  businessName: r.businessName,
  impressum: r.impressum,
  bio: r.bio,
  strengths: r.strengths,
  skills: r.skills,
  experience: r.experience,
  basePostcode: r.basePostcode,
  serviceRadiusKm: r.serviceRadiusKm,
  worksRemotely: r.worksRemotely,
  status: r.status === 'published' ? 'published' : 'draft',
  suspendedUntil: r.suspendedUntil?.toISOString() ?? null,
  missing,
})

/** The caller's provider row (RLS also shows published rows of others; the owner filter picks the caller's). */
export async function ownProvider(tx: Tx, userId: string): Promise<Row | null> {
  return (await tx.select().from(providers).where(eq(providers.ownerId, userId)))[0] ?? null
}

/** Serialises one user's profile writes (a double-tapped first save waits, then takes the update path). */
export const lockProfile = (tx: Tx, userId: string) =>
  tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('provider_profile'), hashtext(${userId}))`)

const blank = (v: string | null | undefined) => !v?.trim()

/** The one list of what a profile still needs before Publish, in the order of `MissingSchema`. */
export function completeness(
  row: Row,
  services: { categoryId: string | null; priceType: string | null }[],
  hasPhoto: boolean,
): Missing[] {
  const biz = row.type === 'business'
  const m: [Missing, boolean][] = [
    ['photo', !hasPhoto],
    ['service', !services.some((s) => s.categoryId && s.priceType)],
    ['providerType', row.type === null],
    ['businessName', biz && blank(row.businessName)],
    ['impressum', biz && blank(row.impressum)],
    ['skills', !row.skills?.length],
    ['experience', blank(row.experience)],
    ['postcode', blank(row.basePostcode)],
    ['radius', !row.serviceRadiusKm],
  ]
  return m.filter(([, need]) => need).map(([k]) => k)
}

/** The profile as the app sees it, with its completeness list. */
async function view(tx: Tx, userId: string, row: Row): Promise<MyProfile> {
  const svc = await tx.select({ categoryId: services.categoryId, priceType: services.priceType }).from(services).where(eq(services.providerId, row.id))
  const pic = (await tx.select({ id: photos.id }).from(photos).where(and(eq(photos.ownerId, userId), eq(photos.kind, 'profile'))))[0]
  return toMyProfile(row, completeness(row, svc, !!pic))
}

export async function getMyProfile(tx: Tx, userId: string): Promise<MyProfile | null> {
  const row = await ownProvider(tx, userId)
  return row ? view(tx, userId, row) : null
}

/**
 * Public name and location are domain-only columns: written through set_provider_identity (SECURITY DEFINER, own row
 * only), which runs inside this transaction and so also sees a row inserted a moment ago.
 */
export async function syncIdentity(tx: Tx, userId: string, row: Row): Promise<void> {
  const person = (await tx.select({ first: users.firstName, last: users.lastName }).from(users).where(eq(users.id, userId)))[0]
  const name = publicNameFor(person?.first ?? null, person?.last ?? null, row.businessName, row.type)
  const hit = row.basePostcode ? await lookupPostcode(row.country, row.basePostcode, tx) : null
  await tx.execute(sql`SELECT set_provider_identity(${name}, ${hit?.lng ?? null}::float8, ${hit?.lat ?? null}::float8)`)
}

const COLUMN: Record<string, string> = {
  type: 'type',
  businessName: 'business_name',
  impressum: 'impressum',
  bio: 'bio',
  strengths: 'strengths',
  skills: 'skills',
  experience: 'experience',
  basePostcode: 'base_postcode',
  serviceRadiusKm: 'service_radius_km',
  worksRemotely: 'works_remotely',
}

// Raw SQL naming only the editable columns: Drizzle lists every column (as DEFAULT), and app_user holds no INSERT
// privilege on the domain-only ones (status, suspended_until, slug, public_name, location).
async function insertProvider(tx: Tx, userId: string, values: Record<string, unknown>): Promise<void> {
  const entries = Object.entries(values)
  const cols = [sql.raw('owner_id'), ...entries.map(([k]) => sql.raw(COLUMN[k]!))]
  const vals = [
    sql`${userId}`,
    ...entries.map(([k, v]) => (k === 'skills' ? sql`ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(v)}::jsonb))` : sql`${v}`)),
  ]
  await tx.execute(sql`INSERT INTO providers (${sql.join(cols, sql`, `)}) VALUES (${sql.join(vals, sql`, `)})`)
}

const clean = (v: string | null) => v?.trim() || null

/** The caller's draft: created on first open (postcode taken from the private address), the same row every time. */
export async function ensureDraft(tx: Tx, userId: string): Promise<MyProfile> {
  return (await ensure(tx, userId)).profile
}

async function ensure(tx: Tx, userId: string): Promise<{ profile: MyProfile; created: boolean }> {
  await lockProfile(tx, userId)
  let row = await ownProvider(tx, userId)
  const created = !row
  if (!row) {
    const u = (await tx.select({ postcode: users.addressPostcode }).from(users).where(eq(users.id, userId)))[0]
    const known = u?.postcode ? await lookupPostcode('DE', u.postcode, tx) : null // an unknown one stays NULL so `postcode` is missing
    await insertProvider(tx, userId, { ...(known && { basePostcode: u!.postcode }), serviceRadiusKm: 25 })
    await tx.update(users).set({ isProvider: true }).where(eq(users.id, userId))
    row = (await ownProvider(tx, userId))!
    await syncIdentity(tx, userId, row)
    row = (await ownProvider(tx, userId))!
  }
  return { profile: await view(tx, userId, row), created }
}

/** Saves what changed on the caller's profile, creating the draft first. 400 only on an unknown postcode; `created` tells 201 from 200. */
export async function upsertMyProfile(
  tx: Tx,
  userId: string,
  input: ProfileInput,
): Promise<{ profile: MyProfile; created: boolean }> {
  const { created } = await ensure(tx, userId)
  const existing = (await ownProvider(tx, userId))!
  const type = input.providerType ? (input.providerType === 'business' ? 'business' : 'private') : undefined
  const basePostcode = input.basePostcode !== undefined ? clean(input.basePostcode) : undefined
  if (basePostcode && !(await lookupPostcode(existing.country, basePostcode, tx))) {
    fail(400, { error: 'Unknown postcode' })
  }
  const values = {
    ...(type !== undefined && { type }),
    ...(input.businessName !== undefined && { businessName: clean(input.businessName) }),
    ...(input.impressum !== undefined && { impressum: clean(input.impressum) }),
    ...(input.bio !== undefined && { bio: clean(input.bio) }),
    ...(input.strengths !== undefined && { strengths: clean(input.strengths) }),
    ...(input.skills !== undefined && { skills: input.skills }),
    ...(input.experience !== undefined && { experience: clean(input.experience) }),
    ...(basePostcode !== undefined && { basePostcode }),
    ...(input.serviceRadiusKm !== undefined && { serviceRadiusKm: input.serviceRadiusKm }),
    ...(input.worksRemotely !== undefined && { worksRemotely: input.worksRemotely }),
  }
  await tx.update(providers).set({ ...values, updatedAt: new Date() }).where(eq(providers.id, existing.id))
  await syncIdentity(tx, userId, (await ownProvider(tx, userId))!)
  return { profile: (await getMyProfile(tx, userId))!, created }
}

/** Publishes the caller's profile: 404 without one, 409 when suspended or incomplete (`missing` lists what). */
export async function publish(tx: Tx, userId: string): Promise<MyProfile> {
  await lockProfile(tx, userId) // serialises with a photo delete between this check and the status change
  const row = await ownProvider(tx, userId)
  if (!row) return fail(404, { error: 'Not found' })
  if (row.suspendedUntil && row.suspendedUntil > new Date()) fail(409, { error: 'Profile suspended' })
  const current = (await view(tx, userId, row)).missing
  if (current.length) fail(409, { error: 'Profile incomplete', missing: current })
  await syncIdentity(tx, userId, row)
  const fresh = (await ownProvider(tx, userId))!
  const slugBase = slugify(fresh.publicName ?? '') // '' (no name) falls back to 'profile'
  const ok = (await tx.execute<{ ok: boolean }>(sql`SELECT set_provider_published(true, ${slugBase}) AS ok`)).rows[0]!.ok
  if (!ok) fail(409, { error: 'Profile suspended' })
  return (await getMyProfile(tx, userId))!
}

export async function unpublish(tx: Tx, userId: string): Promise<MyProfile> {
  if (!(await ownProvider(tx, userId))) return fail(404, { error: 'Not found' })
  await tx.execute(sql`SELECT set_provider_published(false, '')`)
  return (await getMyProfile(tx, userId))!
}
