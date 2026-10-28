import { asc, eq, getTableColumns, sql } from 'drizzle-orm'
import { documents, notifications, photos, privateFiles, providerReferences, providers, services, users, type Tx } from '@kando/db'
import { documentsBucket, photoUrl, storage } from './storage'

const LINK_SECONDS = 300 // signed document links live five minutes

/**
 * Everything the person's own rows hold, as one JSON-ready object (GDPR access and portability). Read as the person
 * (row-level security) and filtered by their id besides. Document and file links are signed and short-lived; the raw
 * location geometry is left out, its latitude and longitude are in.
 */
export async function exportMyData(tx: Tx, userId: string) {
  const [user] = await tx.select().from(users).where(eq(users.id, userId))
  const { location: _geometry, ...providerColumns } = getTableColumns(providers)
  const [provider] = await tx
    .select({ ...providerColumns, lat: sql<number | null>`ST_Y(${providers.location})`, lng: sql<number | null>`ST_X(${providers.location})` })
    .from(providers)
    .where(eq(providers.ownerId, userId))
  const own = provider?.id
  const link = (key: string) => storage().getSignedUrl(documentsBucket(), key, LINK_SECONDS)
  const docs = await tx.select().from(documents).where(eq(documents.ownerId, userId)).orderBy(asc(documents.createdAt))
  const files = await tx.select().from(privateFiles).where(eq(privateFiles.ownerId, userId)).orderBy(asc(privateFiles.createdAt))
  return {
    exportedAt: new Date().toISOString(),
    user: user && {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      language: user.language,
      address: { street: user.addressStreet, postcode: user.addressPostcode, city: user.addressCity, country: user.addressCountry },
      isProvider: user.isProvider,
      staffRole: user.staffRole,
      suspendedUntil: user.suspendedUntil,
      suspendedReason: user.suspendedReason,
      createdAt: user.createdAt,
    },
    provider: provider ?? null,
    services: own ? await tx.select().from(services).where(eq(services.providerId, own)).orderBy(asc(services.sort), asc(services.createdAt)) : [],
    references: own ? await tx.select().from(providerReferences).where(eq(providerReferences.providerId, own)).orderBy(asc(providerReferences.createdAt)) : [],
    photos: (await tx.select().from(photos).where(eq(photos.ownerId, userId)).orderBy(asc(photos.createdAt))).map((p) => ({ kind: p.kind, url: photoUrl(p.key), createdAt: p.createdAt })),
    documents: await Promise.all(
      docs.map(async (d) => ({ requirement: d.requirement, status: d.status, staffNote: d.note, reviewedAt: d.reviewedAt, createdAt: d.createdAt, downloadUrl: await link(d.key) })),
    ),
    privateFiles: await Promise.all(files.map(async (f) => ({ createdAt: f.createdAt, downloadUrl: await link(f.key) }))),
    notifications: await tx.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(asc(notifications.createdAt)),
    notes: [
      'Not included: your password (the sign-in service keeps only a one-way hash) and the sign-in sessions.',
      'Not included: rate-limit records (a time stamp per translation request, an address hash for others), kept for 24 hours.',
      'Not included: emails already sent to you, which the email provider holds.',
      `Document and file download links work for ${LINK_SECONDS / 60} minutes; photo links are public addresses.`,
    ],
  }
}

type Export = Awaited<ReturnType<typeof exportMyData>>

const cell = (v: unknown): string => (v == null ? '' : v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v))

/** One row per field of every record: section, record (1, 2, ...), field, value. Nested objects (the address) become `address.street`; an empty object is a row of its own and a null is a row with an empty value, so nothing silently vanishes. */
export function exportRows(data: Export): string[][] {
  const rows: string[][] = []
  const add = (section: string, record: number, obj: Record<string, unknown>, prefix = '') => {
    for (const [k, v] of Object.entries(obj)) {
      const plain = v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v)
      if (plain && Object.keys(v).length) add(section, record, v as Record<string, unknown>, `${prefix}${k}.`)
      else rows.push([section, String(record), prefix + k, plain ? '{}' : cell(v)])
    }
  }
  add('export', 1, { exportedAt: data.exportedAt })
  if (data.user) add('user', 1, data.user)
  if (data.provider) add('provider', 1, data.provider)
  for (const section of ['services', 'references', 'photos', 'documents', 'privateFiles', 'notifications'] as const) {
    data[section].forEach((r, i) => add(section, i + 1, r))
  }
  data.notes.forEach((n, i) => rows.push(['notes', String(i + 1), 'text', n]))
  return rows
}

const PLAIN_NUMBER = /^-?\d+([.,]\d+)?$/
/**
 * A spreadsheet program runs a cell that starts with = + @ (or a tab, a carriage return, or a minus that is not a plain
 * number) as a formula: such a cell gets a leading single quote. The quote is intentional and part of the CSV value; the JSON export is unchanged.
 */
const noFormula = (s: string) => (/^[=+@\t\r]/.test(s) || (s.startsWith('-') && !PLAIN_NUMBER.test(s)) ? `'${s}` : s)

const quote = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s)

/** RFC 4180 text (CRLF lines) with a UTF-8 byte order mark, so spreadsheet programs show umlauts correctly. */
export const exportCsv = (data: Export): string =>
  '\uFEFF' + [['section', 'record', 'field', 'value'], ...exportRows(data).map(([a, b, c, d]) => [a!, b!, c!, noFormula(d!)])].map((r) => r.map(quote).join(',')).join('\r\n') + '\r\n'
