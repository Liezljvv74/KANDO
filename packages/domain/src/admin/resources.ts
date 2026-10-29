import { and, asc, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm'
import { categories, categoryTexts, pages, notSuspendedSql, pageTexts, photos, providers, users, type Tx } from '@kando/db'
import {
  CategoryInputSchema,
  CategoryUpdateSchema,
  DOCUMENT_TYPES,
  PageInputSchema,
  PageUpdateSchema,
  StaffInputSchema,
  parseBody,
  type AdminListQuery,
} from '@kando/contract'
import type { AfterCommit } from '../app-request'
import { fail } from '../providers/http'
import { isSuspendedNow } from '../providers/profile'
import { mediaBucket, photoUrl, removeObject } from '../storage'
import { activeAdmins, lockAdmins, type StaffRole } from '../users'
import { filterOf, isUuid, like, notFound, ok, orderOf, pageOf, textOf, uniqueViolation } from './common'
import { getDocument, listDocuments } from './documents'
import { fullName, getUser, listUsers, withPictures } from './users'

/** Who may call a resource with a method: a Reviewer reads documents, users and providers and deletes photos; everything else is Administrator only. */
export function roleFor(params: Record<string, string>, method: string): StaffRole {
  const r = params.resource ?? ''
  if (method === 'GET' && ['documents', 'users', 'providers'].includes(r)) return 'reviewer'
  if (method === 'DELETE' && r === 'photos') return 'reviewer'
  return 'admin'
}

const slugTaken = (e: unknown) => (uniqueViolation(e) ? fail(409, { error: 'Slug already exists' }) : Promise.reject(e))

// ---- providers (read) and photos ----

/** The provider is hidden until suspended_until passes. */
const isSuspended = sql<boolean>`NOT ${notSuspendedSql('providers')}`

async function listProviders(tx: Tx, q: AdminListQuery) {
  const f = filterOf(q)
  const text = textOf(f.q)
  const where = and(
    text ? or(ilike(providers.publicName, like(text)), ilike(users.email, like(text))) : undefined,
    textOf(f.status) ? eq(providers.status, textOf(f.status)!) : undefined,
    typeof f.suspended === 'boolean' ? sql`${isSuspended} = ${f.suspended}` : undefined,
  )
  const total = (await tx.select({ n: count() }).from(providers).innerJoin(users, eq(users.id, providers.ownerId)).where(where))[0]!.n
  const rows = await tx
    .select({
      id: providers.id,
      publicName: providers.publicName,
      slug: providers.slug,
      type: providers.type,
      status: providers.status,
      suspended: isSuspended,
      ownerId: providers.ownerId,
      ownerEmail: users.email,
      createdAt: providers.createdAt,
    })
    .from(providers)
    .innerJoin(users, eq(users.id, providers.ownerId))
    .where(where)
    .orderBy(...orderOf(q.sort, { createdAt: providers.createdAt, publicName: providers.publicName }, [desc(providers.createdAt)]))
    .limit(pageOf(q).limit)
    .offset(pageOf(q).offset)
  return ok(rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })), total)
}

async function getProvider(tx: Tx, id: string) {
  const [p] = isUuid(id)
    ? await tx.select({ provider: providers, ownerEmail: users.email }).from(providers).innerJoin(users, eq(users.id, providers.ownerId)).where(eq(providers.id, id))
    : []
  if (!p) return notFound()
  // the provider's own photos and the person's picture (it belongs to the person, not the profile)
  const pics = await tx.select().from(photos).where(or(eq(photos.providerId, id), and(eq(photos.ownerId, p.provider.ownerId), eq(photos.kind, 'profile')))).orderBy(asc(photos.sort), asc(photos.createdAt))
  const { location, ...rest } = p.provider
  void location
  return ok({
    ...rest,
    suspended: await isSuspendedNow(tx, id),
    suspendedUntil: rest.suspendedUntil?.toISOString() ?? null,
    createdAt: rest.createdAt.toISOString(),
    updatedAt: rest.updatedAt.toISOString(),
    ownerEmail: p.ownerEmail,
    photos: pics.map((x) => ({ id: x.id, kind: x.kind, alt: x.alt, url: photoUrl(x.key) })),
  })
}

/** A Reviewer removes a photo that breaks the rules. A published profile that loses the person's picture goes back to draft. */
async function deletePhoto(tx: Tx, id: string, afterCommit: AfterCommit) {
  const row = isUuid(id) ? (await tx.select().from(photos).where(eq(photos.id, id)))[0] : undefined
  if (!row) return notFound()
  if (row.kind === 'profile') {
    await tx
      .update(providers)
      .set({ status: 'draft', updatedAt: new Date() })
      .where(and(eq(providers.ownerId, row.ownerId), eq(providers.status, 'published')))
  }
  await tx.delete(photos).where(eq(photos.id, id))
  afterCommit(() => removeObject(mediaBucket(), row.key))
  return new Response(null, { status: 204 })
}

// ---- categories ----

async function withNames(tx: Tx, rows: (typeof categories.$inferSelect)[]) {
  const texts = rows.length ? await tx.select().from(categoryTexts).where(inArray(categoryTexts.categoryId, rows.map((r) => r.id))) : []
  const name = (id: string, lang: string) => texts.find((t) => t.categoryId === id && t.lang === lang)?.name ?? ''
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    sort: r.sort,
    requiredDocuments: r.requiredDocuments,
    optionalDocuments: r.optionalDocuments,
    names: { de: name(r.id, 'de'), en: name(r.id, 'en') },
  }))
}

async function listCategories(tx: Tx, q: AdminListQuery) {
  const text = textOf(filterOf(q).q)
  const where = text
    ? or(ilike(categories.slug, like(text)), sql`exists (select 1 from category_texts ct where ct.category_id = ${categories.id} and ct.name ilike ${like(text)})`)
    : undefined
  const total = (await tx.select({ n: count() }).from(categories).where(where))[0]!.n
  const rows = await tx
    .select()
    .from(categories)
    .where(where)
    .orderBy(...orderOf(q.sort, { slug: categories.slug, sort: categories.sort }, [asc(categories.sort), asc(categories.slug)]))
    .limit(pageOf(q).limit)
    .offset(pageOf(q).offset)
  return ok(await withNames(tx, rows), total)
}

async function getCategory(tx: Tx, id: string) {
  const row = isUuid(id) ? (await tx.select().from(categories).where(eq(categories.id, id)))[0] : undefined
  return row ? ok((await withNames(tx, [row]))[0]) : notFound()
}

const unknownDocs = (docs?: string[]) => !!docs?.some((d) => !(DOCUMENT_TYPES as readonly string[]).includes(d))

/** 400 for a type outside DOCUMENT_TYPES, or one listed as both required and optional; null when fine. */
const docListsError = (b: { requiredDocuments?: string[]; optionalDocuments?: string[] }) =>
  unknownDocs(b.requiredDocuments) || unknownDocs(b.optionalDocuments)
    ? fail(400, { error: 'Unknown required document' })
    : b.requiredDocuments?.some((d) => b.optionalDocuments?.includes(d))
      ? fail(400, { error: 'A document cannot be both required and optional' })
      : null

async function writeNames(tx: Tx, id: string, names: { de: string; en?: string }) {
  await tx.delete(categoryTexts).where(eq(categoryTexts.categoryId, id))
  await tx.insert(categoryTexts).values([{ categoryId: id, lang: 'de', name: names.de }, ...(names.en ? [{ categoryId: id, lang: 'en', name: names.en }] : [])])
}

async function createCategory(tx: Tx, request: Request) {
  const b = await parseBody(CategoryInputSchema, request)
  const bad = docListsError(b)
  if (bad) return bad
  const [row] = await tx
    .insert(categories)
    .values({ slug: b.slug, sort: b.sort ?? 0, requiredDocuments: b.requiredDocuments ?? [], optionalDocuments: b.optionalDocuments ?? [] })
    .returning({ id: categories.id })
    .catch(slugTaken)
  await writeNames(tx, row!.id, b.names)
  const created = await getCategory(tx, row!.id)
  return ok(((await created.json()) as { data: unknown }).data, undefined, 201)
}

async function updateCategory(tx: Tx, id: string, request: Request) {
  const b = await parseBody(CategoryUpdateSchema, request)
  const bad = docListsError(b)
  if (bad) return bad
  if (!isUuid(id) || !(await tx.select({ id: categories.id }).from(categories).where(eq(categories.id, id))).length) return notFound()
  const set = { ...(b.slug !== undefined && { slug: b.slug }), ...(b.sort !== undefined && { sort: b.sort }), ...(b.requiredDocuments && { requiredDocuments: b.requiredDocuments }), ...(b.optionalDocuments && { optionalDocuments: b.optionalDocuments }) }
  if (Object.keys(set).length) await tx.update(categories).set(set).where(eq(categories.id, id)).catch(slugTaken)
  if (b.names) await writeNames(tx, id, b.names)
  return getCategory(tx, id)
}

// ---- pages ----

async function withTexts(tx: Tx, rows: (typeof pages.$inferSelect)[]) {
  const texts = rows.length ? await tx.select().from(pageTexts).where(inArray(pageTexts.pageId, rows.map((r) => r.id))) : []
  const text = (id: string, lang: string) => {
    const t = texts.find((x) => x.pageId === id && x.lang === lang)
    return { title: t?.title ?? '', body: t?.bodyMarkdown ?? '' }
  }
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    kind: r.kind,
    published: r.published,
    publishedAt: r.publishedAt?.toISOString() ?? null,
    texts: { de: text(r.id, 'de'), en: text(r.id, 'en') },
  }))
}

async function listPages(tx: Tx, q: AdminListQuery) {
  const text = textOf(filterOf(q).q)
  const where = text
    ? or(ilike(pages.slug, like(text)), sql`exists (select 1 from page_texts pt where pt.page_id = ${pages.id} and pt.title ilike ${like(text)})`)
    : undefined
  const total = (await tx.select({ n: count() }).from(pages).where(where))[0]!.n
  const rows = await tx
    .select()
    .from(pages)
    .where(where)
    .orderBy(...orderOf(q.sort, { slug: pages.slug, kind: pages.kind }, [asc(pages.slug)]))
    .limit(pageOf(q).limit)
    .offset(pageOf(q).offset)
  return ok(await withTexts(tx, rows), total)
}

async function getPageRow(tx: Tx, id: string) {
  const row = isUuid(id) ? (await tx.select().from(pages).where(eq(pages.id, id)))[0] : undefined
  return row ? ok((await withTexts(tx, [row]))[0]) : notFound()
}

type Text = { title: string; body: string }
/** German is upserted; an English text with an empty title removes the English version (the site falls back to German). */
async function writeTexts(tx: Tx, id: string, texts: { de: Text; en?: Text }) {
  const put = (lang: string, t: Text) =>
    tx
      .insert(pageTexts)
      .values({ pageId: id, lang, title: t.title, bodyMarkdown: t.body })
      .onConflictDoUpdate({ target: [pageTexts.pageId, pageTexts.lang], set: { title: t.title, bodyMarkdown: t.body } })
  await put('de', texts.de)
  if (texts.en?.title) await put('en', texts.en)
  else if (texts.en) await tx.delete(pageTexts).where(and(eq(pageTexts.pageId, id), eq(pageTexts.lang, 'en')))
}

async function createPage(tx: Tx, request: Request) {
  const b = await parseBody(PageInputSchema, request)
  const published = b.published ?? false
  const [row] = await tx
    .insert(pages)
    .values({ slug: b.slug, kind: b.kind ?? 'page', published, publishedAt: published ? new Date() : null })
    .returning({ id: pages.id })
    .catch(slugTaken)
  await writeTexts(tx, row!.id, b.texts)
  const created = await getPageRow(tx, row!.id)
  return ok(((await created.json()) as { data: unknown }).data, undefined, 201)
}

async function updatePage(tx: Tx, id: string, request: Request) {
  const b = await parseBody(PageUpdateSchema, request)
  const row = isUuid(id) ? (await tx.select().from(pages).where(eq(pages.id, id)))[0] : undefined
  if (!row) return notFound()
  const set = {
    ...(b.slug !== undefined && { slug: b.slug }),
    ...(b.kind !== undefined && { kind: b.kind }),
    ...(b.published !== undefined && { published: b.published, publishedAt: b.published ? (row.publishedAt ?? new Date()) : row.publishedAt }),
  }
  if (Object.keys(set).length) await tx.update(pages).set(set).where(eq(pages.id, id)).catch(slugTaken)
  if (b.texts) await writeTexts(tx, id, b.texts)
  return getPageRow(tx, id)
}

// ---- staff ----

async function listStaff(tx: Tx, q: AdminListQuery) {
  const text = textOf(filterOf(q).q)
  const where = and(sql`${users.staffRole} is not null`, text ? or(ilike(users.email, like(text)), ilike(fullName, like(text))) : undefined)
  const total = (await tx.select({ n: count() }).from(users).where(where))[0]!.n
  const rows = await tx.select().from(users).where(where).orderBy(asc(users.email)).limit(pageOf(q).limit).offset(pageOf(q).offset)
  return ok(await withPictures(tx, rows), total)
}

/** Sets or clears users.staff_role by email. The Administrator rows are locked, so two demotions cannot together remove the last one. */
async function setStaffRole(tx: Tx, request: Request) {
  const b = await parseBody(StaffInputSchema, request)
  const target = (await tx.select().from(users).where(sql`lower(${users.email}) = ${b.email}`))[0]
  if (!target) return notFound()
  // Lock order as in deleteAccount: the Administrator set first, then the target row.
  const admins = await lockAdmins(tx)
  if (target.staffRole === 'admin' && b.staffRole !== 'admin' && activeAdmins(admins).length <= 1) return fail(409, { error: 'The last Administrator cannot be demoted' })
  const [row] = await tx.update(users).set({ staffRole: b.staffRole, updatedAt: new Date() }).where(eq(users.id, target.id)).returning()
  return ok((await withPictures(tx, [row!]))[0])
}

// ---- dispatch (the routes stay thin) ----

const lists = { documents: listDocuments, users: listUsers, providers: listProviders, categories: listCategories, pages: listPages, staff: listStaff }
export const adminList = (tx: Tx, resource: string, q: AdminListQuery): Promise<Response> | Response =>
  Object.hasOwn(lists, resource) ? lists[resource as keyof typeof lists](tx, q) : notFound()

const gets = { documents: getDocument, users: getUser, providers: getProvider, categories: getCategory, pages: getPageRow }
export const adminGet = (tx: Tx, resource: string, id: string): Promise<Response> | Response =>
  Object.hasOwn(gets, resource) ? gets[resource as keyof typeof gets](tx, id) : notFound()

export const adminCreate = (tx: Tx, resource: string, request: Request) =>
  resource === 'categories' ? createCategory(tx, request) : resource === 'pages' ? createPage(tx, request) : notFound()

export const adminUpdate = (tx: Tx, resource: string, id: string, request: Request) =>
  resource === 'categories' ? updateCategory(tx, id, request) : resource === 'pages' ? updatePage(tx, id, request) : notFound()

export async function adminRemove(tx: Tx, resource: string, id: string, afterCommit: AfterCommit): Promise<Response> {
  if (resource === 'photos') return deletePhoto(tx, id, afterCommit)
  if (resource === 'pages' && isUuid(id)) {
    const gone = await tx.delete(pages).where(eq(pages.id, id)).returning({ id: pages.id })
    return gone.length ? new Response(null, { status: 204 }) : notFound()
  }
  return notFound()
}

/** PATCH /api/admin/staff. */
export const adminSetStaff = (tx: Tx, resource: string, request: Request) => (resource === 'staff' ? setStaffRole(tx, request) : notFound())
