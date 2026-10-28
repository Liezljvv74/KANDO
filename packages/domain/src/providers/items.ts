import { and, desc, eq, sql } from 'drizzle-orm'
import { categories, categoryTexts, providerReferences, providers, services, users, type Tx } from '@kando/db'
import { DEFAULT_LANG } from '@kando/i18n'
import type { OwnReference, OwnService, ReferenceInput, ReferencePatch, ServiceInput, ServicePatch } from '@kando/contract'
import { missingRequirements } from './eligibility'
import { fail } from './http'
import { getMyProfile, lockProfile, ownProvider } from './profile'

/** Owner decision: customer ratings matter more than self-listed references. */
export const MAX_PROVIDER_REFERENCES = 2

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
type ServiceRow = typeof services.$inferSelect

const toService = (r: ServiceRow): OwnService => ({
  id: r.id,
  category: r.categoryId,
  title: r.title,
  description: r.description,
  priceType: r.priceType as OwnService['priceType'], // null until set
  price: r.price === null ? null : Number(r.price),
  currency: r.currency as OwnService['currency'],
})

const toReference = (r: typeof providerReferences.$inferSelect): OwnReference => ({
  id: r.id,
  clientName: r.clientName,
  description: r.description,
  year: r.year,
})

const noProfile = () => fail(409, { error: 'Create your profile first' })

async function assertCategory(tx: Tx, id: string) {
  const ok = UUID.test(id) && (await tx.select({ id: categories.id }).from(categories).where(eq(categories.id, id))).length > 0
  if (!ok) fail(400, { error: 'Unknown category' })
}

/** The category's name in the user's language (default language when missing): the title of a service saved without one. */
async function categoryTitle(tx: Tx, userId: string, categoryId: string): Promise<string> {
  const lang = (await tx.select({ l: users.language }).from(users).where(eq(users.id, userId)))[0]?.l ?? DEFAULT_LANG
  const names = await tx.select({ lang: categoryTexts.lang, name: categoryTexts.name }).from(categoryTexts).where(eq(categoryTexts.categoryId, categoryId))
  return (names.find((n) => n.lang === lang) ?? names.find((n) => n.lang === DEFAULT_LANG))?.name ?? ''
}

/** The caller's services, newest first, each with whether it shows in search and which documents it waits for. */
export async function listServices(tx: Tx, userId: string): Promise<OwnService[]> {
  const profile = await ownProvider(tx, userId)
  if (!profile) return []
  const rows = await tx
    .select({ s: services })
    .from(services)
    .where(eq(services.providerId, profile.id))
    .orderBy(desc(services.createdAt), desc(services.id))
  const out: OwnService[] = []
  for (const { s } of rows) out.push(await withState(tx, profile, s))
  return out
}

/** One service with whether it shows in search and which documents it waits for: the same answer from list, add and update. */
async function withState(tx: Tx, profile: NonNullable<Awaited<ReturnType<typeof ownProvider>>>, s: ServiceRow): Promise<OwnService> {
  const live = profile.status === 'published' && (!profile.suspendedUntil || profile.suspendedUntil <= new Date())
  const waitingFor = await missingRequirements(tx, profile.id, s.id)
  return { ...toService(s), visibleInSearch: live && waitingFor.length === 0, waitingFor, categoryInactive: false }
}

export async function addService(tx: Tx, userId: string, input: ServiceInput): Promise<OwnService> {
  const profile = (await ownProvider(tx, userId)) ?? noProfile()
  await assertCategory(tx, input.categoryId)
  const price = input.priceType === 'on-request' ? null : (input.price ?? null)
  const [row] = await tx
    .insert(services)
    .values({
      providerId: profile.id, // always the caller's own profile, never from the body
      categoryId: input.categoryId,
      title: input.title?.trim() || (await categoryTitle(tx, userId, input.categoryId)), // a category alone is enough until Publish
      description: input.description?.trim() || null,
      priceType: input.priceType ?? null,
      price: price === null ? null : price.toFixed(2),
      currency: input.currency ?? 'EUR', // ponytail: EUR only in v1; derive from the provider's country when a second currency exists
    })
    .returning()
  return withState(tx, profile, row!)
}

const ownServiceRow = async (tx: Tx, userId: string, id: string) =>
  !UUID.test(id)
    ? null
    : ((
        await tx
          .select({ s: services })
          .from(services)
          .innerJoin(providers, eq(providers.id, services.providerId))
          .where(and(eq(services.id, id), eq(providers.ownerId, userId)))
      )[0]?.s ?? null)

/** null when the service is not the caller's (the route answers 404). */
export async function updateService(tx: Tx, userId: string, id: string, patch: ServicePatch): Promise<OwnService | null> {
  const existing = await ownServiceRow(tx, userId, id)
  if (!existing) return null
  const profile = (await ownProvider(tx, userId))!
  const priceType = patch.priceType ?? (existing.priceType as ServicePatch['priceType'] | null)
  // the type and the price save one field at a time: keep a sent price whatever the type is (completeness decides later)
  const price = priceType === 'on-request' ? null : patch.price !== undefined ? patch.price : existing.price === null ? null : Number(existing.price)
  if (patch.categoryId !== undefined) await assertCategory(tx, patch.categoryId)
  const [row] = await tx
    .update(services)
    .set({
      ...(patch.categoryId !== undefined && { categoryId: patch.categoryId }),
      ...(patch.title !== undefined && { title: patch.title.trim() || (await categoryTitle(tx, userId, patch.categoryId ?? existing.categoryId)) }),
      ...(patch.description !== undefined && { description: patch.description?.trim() || null }),
      ...(patch.currency !== undefined && { currency: patch.currency }),
      priceType,
      price: price === null ? null : price.toFixed(2),
    })
    .where(eq(services.id, id))
    .returning()
  return withState(tx, profile, row!)
}

export async function deleteService(tx: Tx, userId: string, id: string): Promise<boolean> {
  const existing = await ownServiceRow(tx, userId, id)
  if (!existing) return false
  await lockProfile(tx, userId) // serialises with publish and the other edits
  await tx.delete(services).where(eq(services.id, id))
  // a live profile stays complete: the throw rolls the delete back
  const profile = (await getMyProfile(tx, userId))!
  if (profile.status === 'published' && profile.missing.length) fail(409, { error: 'Profile incomplete', missing: profile.missing })
  return true
}

export async function listReferences(tx: Tx, userId: string): Promise<OwnReference[]> {
  const profile = await ownProvider(tx, userId)
  if (!profile) return []
  const rows = await tx
    .select()
    .from(providerReferences)
    .where(eq(providerReferences.providerId, profile.id))
    .orderBy(desc(providerReferences.createdAt), desc(providerReferences.id))
  return rows.map(toReference)
}

export async function addReference(tx: Tx, userId: string, input: ReferenceInput): Promise<OwnReference> {
  await lockProfile(tx, userId) // concurrent creates cannot pass the limit together
  const profile = (await ownProvider(tx, userId)) ?? noProfile()
  const [{ n }] = (await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(providerReferences)
    .where(eq(providerReferences.providerId, profile.id))) as [{ n: number }]
  if (n >= MAX_PROVIDER_REFERENCES) fail(409, { error: 'Reference limit reached' })
  const [row] = await tx
    .insert(providerReferences)
    .values({ providerId: profile.id, clientName: input.clientName, description: input.description, year: input.year ?? null })
    .returning()
  return toReference(row!)
}

const ownReferenceRow = async (tx: Tx, userId: string, id: string) =>
  !UUID.test(id)
    ? null
    : ((
        await tx
          .select({ r: providerReferences })
          .from(providerReferences)
          .innerJoin(providers, eq(providers.id, providerReferences.providerId))
          .where(and(eq(providerReferences.id, id), eq(providers.ownerId, userId)))
      )[0]?.r ?? null)

export async function updateReference(tx: Tx, userId: string, id: string, patch: ReferencePatch): Promise<OwnReference | null> {
  if (!(await ownReferenceRow(tx, userId, id))) return null
  const [row] = await tx
    .update(providerReferences)
    .set({
      ...(patch.clientName !== undefined && { clientName: patch.clientName }),
      ...(patch.description !== undefined && { description: patch.description }),
      ...(patch.year !== undefined && { year: patch.year }),
    })
    .where(eq(providerReferences.id, id))
    .returning()
  return toReference(row!)
}

export async function deleteReference(tx: Tx, userId: string, id: string): Promise<boolean> {
  if (!(await ownReferenceRow(tx, userId, id))) return false
  await tx.delete(providerReferences).where(eq(providerReferences.id, id))
  return true
}
