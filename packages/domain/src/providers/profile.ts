import { eq, sql } from 'drizzle-orm'
import { lookupPostcode, providers, services, users, type Tx } from '@kando/db'
import type { MyProfile, ProfileInput } from '@kando/contract'
import { fail } from './http'
import { publicNameFor } from './public-name'
import { slugify } from './slug'

type Row = typeof providers.$inferSelect

const toMyProfile = (r: Row): MyProfile => ({
  id: r.id,
  displayName: r.displayName,
  publicName: r.publicName,
  providerType: r.type === 'business' ? 'business' : 'individual',
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
  suspended: r.suspended,
})

/** The caller's provider row (RLS also shows published rows of others; the owner filter picks the caller's). */
export async function ownProvider(tx: Tx, userId: string): Promise<Row | null> {
  return (await tx.select().from(providers).where(eq(providers.ownerId, userId)))[0] ?? null
}

/** Serialises one user's profile writes (a double-tapped first save waits, then takes the update path). */
export const lockProfile = (tx: Tx, userId: string) =>
  tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('provider_profile'), hashtext(${userId}))`)

export async function getMyProfile(tx: Tx, userId: string): Promise<MyProfile | null> {
  const row = await ownProvider(tx, userId)
  return row ? toMyProfile(row) : null
}

/**
 * Public name and location are domain-only columns: written through set_provider_identity (SECURITY DEFINER, own row
 * only), which runs inside this transaction and so also sees a row inserted a moment ago.
 */
async function syncIdentity(tx: Tx, userId: string, row: Row): Promise<void> {
  const account = (await tx.select({ name: users.name }).from(users).where(eq(users.id, userId)))[0]?.name ?? ''
  const providerType = row.type === 'business' ? 'business' : 'individual'
  const name = publicNameFor({ providerType, businessName: row.businessName }, account)
  const hit = row.basePostcode ? await lookupPostcode(row.country, row.basePostcode, tx) : null
  await tx.execute(sql`SELECT set_provider_identity(${name}, ${hit?.lng ?? null}::float8, ${hit?.lat ?? null}::float8)`)
}

const COLUMN: Record<string, string> = {
  displayName: 'display_name',
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
// privilege on the domain-only ones (status, suspended, slug, public_name, location).
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

/** Creates or updates the caller's profile. 400 on an unknown postcode or missing fields; `created` tells 201 from 200. */
export async function upsertMyProfile(
  tx: Tx,
  userId: string,
  input: ProfileInput,
): Promise<{ profile: MyProfile; created: boolean }> {
  await lockProfile(tx, userId)
  const existing = await ownProvider(tx, userId)
  if (!existing) {
    const fields = (['displayName', 'providerType'] as const).filter((f) => input[f] === undefined)
    if (fields.length) fail(400, { error: 'Invalid fields', fields })
  }
  const type = input.providerType ? (input.providerType === 'business' ? 'business' : 'private') : existing?.type
  const businessName = input.businessName !== undefined ? clean(input.businessName) : (existing?.businessName ?? null)
  if (type === 'business' && !businessName) fail(400, { error: 'Invalid fields', fields: ['businessName'] })
  const basePostcode = input.basePostcode !== undefined ? clean(input.basePostcode) : undefined
  if (basePostcode && !(await lookupPostcode(existing?.country ?? 'DE', basePostcode, tx))) {
    fail(400, { error: 'Unknown postcode' })
  }
  const values = {
    ...(input.displayName !== undefined && { displayName: input.displayName }),
    ...(type !== undefined && { type }),
    ...(input.businessName !== undefined && { businessName }),
    ...(input.impressum !== undefined && { impressum: clean(input.impressum) }),
    ...(input.bio !== undefined && { bio: clean(input.bio) }),
    ...(input.strengths !== undefined && { strengths: clean(input.strengths) }),
    ...(input.skills !== undefined && { skills: input.skills }),
    ...(input.experience !== undefined && { experience: clean(input.experience) }),
    ...(basePostcode !== undefined && { basePostcode }),
    ...(input.serviceRadiusKm !== undefined && { serviceRadiusKm: input.serviceRadiusKm }),
    ...(input.worksRemotely !== undefined && { worksRemotely: input.worksRemotely }),
  }
  if (existing) {
    await tx.update(providers).set({ ...values, updatedAt: new Date() }).where(eq(providers.id, existing.id))
  } else {
    await insertProvider(tx, userId, values)
  }
  const row = (await ownProvider(tx, userId))!
  await syncIdentity(tx, userId, row)
  return { profile: toMyProfile((await ownProvider(tx, userId))!), created: !existing }
}

/** Publishes the caller's profile: 404 without one, 409 when suspended or incomplete (`missing` lists what). */
export async function publish(tx: Tx, userId: string): Promise<MyProfile> {
  await lockProfile(tx, userId) // serialises with a photo delete between this check and the status change
  const row = await ownProvider(tx, userId)
  if (!row) return fail(404, { error: 'Not found' })
  if (row.suspended) fail(409, { error: 'Profile suspended' })
  const count = (await tx.select({ n: sql<number>`count(*)::int` }).from(services).where(eq(services.providerId, row.id)))[0]!.n
  const missing: string[] = []
  if (!row.displayName) missing.push('displayName')
  if (row.type === 'business' && !row.impressum) missing.push('impressum')
  if (!row.photoId) missing.push('photo')
  if (!count) missing.push('service')
  if (!row.basePostcode && !row.worksRemotely) missing.push('location')
  if (missing.length) fail(409, { error: 'Profile incomplete', missing })
  await syncIdentity(tx, userId, row)
  const fresh = (await ownProvider(tx, userId))!
  const slugBase = slugify(fresh.publicName ?? fresh.displayName)
  const ok = (await tx.execute<{ ok: boolean }>(sql`SELECT set_provider_published(true, ${slugBase}) AS ok`)).rows[0]!.ok
  if (!ok) fail(409, { error: 'Profile suspended' })
  return toMyProfile((await ownProvider(tx, userId))!)
}

export async function unpublish(tx: Tx, userId: string): Promise<MyProfile> {
  if (!(await ownProvider(tx, userId))) return fail(404, { error: 'Not found' })
  await tx.execute(sql`SELECT set_provider_published(false, '')`)
  return toMyProfile((await ownProvider(tx, userId))!)
}
