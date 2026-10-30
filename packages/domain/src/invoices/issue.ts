import { and, asc, desc, eq, isNull, or, sql, type SQL } from 'drizzle-orm'
import { bookings, db, invoices, providers, type Tx } from '@kando/db'
import type { Invoice } from '@kando/contract'
import { isUuid } from '../admin/common'
import { notifyBookingEvent } from '../bookings/notify'
import { describeError } from '../log-error'
import { LIVE_PAYMENTS_ALLOWED } from '../payments/rules'
import type { Exec } from '../providers/eligibility'
import { fail } from '../providers/http'
import { ownProvider } from '../providers/profile'
import { documentsBucket, storage } from '../storage'
import { buildInvoice, type InvoiceDraft } from './build'
import { formatNumber, nextNumber, providerSeries } from './numbering'
import { renderPdf } from './pdf'

/** Statuses a booking never leaves. `disputed`, `stopped`, `finished` and `confirmed` still move money; they wait. */
export const FINAL_STATUSES = ['completed', 'cancelled', 'refunded', 'expired', 'declined', 'withdrawn'] as const
/** A signed PDF link lives this long. */
export const INVOICE_LINK_SECONDS = 600
/** At most this many groups per sweep (on top of the time budget). */
const ISSUE_CAP = 200

const FINAL = sql.join(FINAL_STATUSES.map((s) => sql`${s}`), sql`, `)
const inGroup = (alias: string, root: SQL) => sql`(${sql.identifier(alias)}.id = ${root} OR ${sql.identifier(alias)}.parent_booking_id = ${root})`

/**
 * The root booking `r` is due for its invoice: none yet; every booking of its group (the root and its additional tasks) in a
 * final status with its money settled (paid means released: settle is retry-safe, so a half-done one waits); no additional
 * task still on its way (an open request, or one with a live quote: it may still become a paid booking of this group); and
 * at least one booking whose payout counts as a line (buildInvoice's rule: not refunded, not cancelled by the provider, not
 * a provider no-show), so a group that paid the provider nothing is never picked again.
 */
const isDue = (now: Date) => sql`r.parent_booking_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.root_booking_id = r.id)
  AND NOT EXISTS (SELECT 1 FROM bookings g WHERE ${inGroup('g', sql`r.id`)} AND (g.status NOT IN (${FINAL}) OR (g.paid_at IS NOT NULL AND g.released_at IS NULL)))
  AND NOT EXISTS (SELECT 1 FROM requests q WHERE q.parent_booking_id = r.id AND (q.status = 'open'
    OR (q.status = 'quoted' AND EXISTS (SELECT 1 FROM quotes x WHERE x.request_id = q.id AND x.status = 'sent' AND x.expires_at > ${now.toISOString()}::timestamptz))))
  AND EXISTS (SELECT 1 FROM bookings g JOIN ledger_entries l ON l.booking_id = g.id AND l.kind IN ('transfer', 'commission')
    WHERE ${inGroup('g', sql`r.id`)} AND g.released_at IS NOT NULL AND g.status <> 'refunded'
      AND g.cancelled_by IS DISTINCT FROM 'provider' AND g.no_show IS DISTINCT FROM 'provider')`

type GroupRow = {
  id: string
  parent_booking_id: string | null
  status: string
  amount: string
  material_amount: string
  start_at: Date | string
  cancelled_by: string | null
  no_show: string | null
  title: string
  share: string
}

const nameOf = (first: string | null, last: string | null) => [first, last].filter((x) => x?.trim()).join(' ') || '-'

/**
 * Issues the invoice of one due group, or null (not due, or issued by someone else meanwhile). One owner transaction: the
 * root row is locked (a second sweep waits here and then finds the invoice; an additional task's accept locks the same row,
 * so it lands before or after, never in between), the group is read and re-checked under the lock, the number is taken
 * and the invoice inserted. A conflict on the root (never expected under the lock) throws, so the counter bump rolls back
 * with it: no gap.
 */
async function issueOne(rootId: string, now: Date): Promise<typeof invoices.$inferSelect | null> {
  return db.transaction(async (o) => {
    const [root] = await o.select().from(bookings).where(eq(bookings.id, rootId)).for('update')
    if (!root) return null
    const due = await o.execute(sql`SELECT 1 FROM bookings r WHERE r.id = ${rootId} AND ${isDue(now)}`)
    if (!due.rows.length) return null
    const group = (
      await o.execute<GroupRow>(sql`
      SELECT b.id, b.parent_booking_id, b.status, b.amount::text AS amount, b.material_amount::text AS material_amount, b.start_at,
        b.cancelled_by, b.no_show, coalesce(q.scope, s.title, rq.description, '') AS title,
        (CASE WHEN b.released_at IS NULL THEN 0
          ELSE coalesce((SELECT sum(l.amount) FROM ledger_entries l WHERE l.booking_id = b.id AND l.kind IN ('transfer', 'commission')), 0) END)::text AS share
      FROM bookings b LEFT JOIN quotes q ON q.id = b.quote_id LEFT JOIN services s ON s.id = b.service_id LEFT JOIN requests rq ON rq.id = b.request_id
      WHERE ${inGroup('b', sql`${rootId}::uuid`)}`)
    ).rows
    const [p] = (
      await o.execute<{ legal_status: string | null; business_name: string | null; impressum: string | null; vat_id: string | null; tax_number: string | null; base_postcode: string | null; country: string; first_name: string | null; last_name: string | null; place: string | null }>(sql`
      SELECT p.legal_status, p.business_name, p.impressum, p.vat_id, p.tax_number, p.base_postcode, p.country, u.first_name, u.last_name, pc.place
      FROM providers p JOIN users u ON u.id = p.owner_id LEFT JOIN postcodes pc ON pc.country = p.country AND pc.code = p.base_postcode
      WHERE p.id = ${root.providerId}`)
    ).rows
    const [c] = (await o.execute<{ first_name: string | null; last_name: string | null }>(sql`SELECT first_name, last_name FROM users WHERE id = ${root.customerId}`)).rows
    if (!p || !c) return null
    const draft = buildInvoice({
      provider: { legalStatus: p.legal_status, fullName: nameOf(p.first_name, p.last_name), businessName: p.business_name, impressum: p.impressum, vatId: p.vat_id, taxNumber: p.tax_number, basePostcode: p.base_postcode, basePlace: p.place },
      customer: {
        fullName: nameOf(c.first_name, c.last_name),
        jobAddress: root.onSite ? [root.addressStreet, [root.addressPostcode, root.addressCity].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null : null,
      },
      bookings: group.map((g) => ({
        id: g.id,
        parentBookingId: g.parent_booking_id,
        status: g.status,
        amount: Number(g.amount),
        materialAmount: Number(g.material_amount),
        providerShare: Number(g.share),
        startAt: new Date(g.start_at),
        title: g.title,
        cancelledBy: g.cancelled_by,
        noShow: g.no_show,
      })),
      country: p.country,
      currency: root.currency,
    })
    if (!draft) return null
    const series = providerSeries(root.providerId, now)
    const number = formatNumber(series, await nextNumber(o, series))
    const [row] = await o
      .insert(invoices)
      .values({ rootBookingId: rootId, providerId: root.providerId, customerId: root.customerId, number, kind: draft.kind, issuedAt: now, currency: draft.currency, total: draft.totals.gross.toFixed(2), draft })
      .onConflictDoNothing({ target: invoices.rootBookingId })
      .returning()
    if (!row) throw new Error(`invoice for ${rootId} already exists`) // rolls the counter back: no gap
    return row
  })
}

/**
 * Renders and stores an issued invoice's PDF (`invoices/<providerId>/<number>.pdf` in the documents bucket) and records
 * the key; the run that records it tells both parties (`invoice-ready`), so they are told once, when the download works.
 * A storage failure leaves `fileKey` null for the next sweep. Never throws.
 */
async function storePdf(inv: typeof invoices.$inferSelect): Promise<void> {
  try {
    const key = `invoices/${inv.providerId}/${inv.number}.pdf`
    const bytes = await renderPdf(inv.draft as InvoiceDraft, inv.number, inv.issuedAt, !LIVE_PAYMENTS_ALLOWED)
    await storage().put(documentsBucket(), key, Buffer.from(bytes), 'application/pdf')
    const [done] = await db.update(invoices).set({ fileKey: key }).where(and(eq(invoices.id, inv.id), isNull(invoices.fileKey))).returning({ id: invoices.id })
    if (!done) return
    const owner = (await db.select({ id: providers.ownerId }).from(providers).where(eq(providers.id, inv.providerId)))[0]?.id
    for (const u of [inv.customerId, owner]) if (u) await notifyBookingEvent('invoice-ready', u, { bookingId: inv.rootBookingId })
  } catch (e) {
    console.error(`[invoices] PDF of ${inv.number} not stored: ${describeError(e)}`)
  }
}

/**
 * The idempotent invoicing sweep (owner connection, never an open transaction: each invoice commits on its own). First the
 * PDFs a storage failure left out, then every due group (isDue), each in its own transaction (issueOne), oldest id first,
 * until `timeUp` or ISSUE_CAP. `bookingId` narrows it to that booking's group (the ending paths, after their commit).
 * Returns how many invoices it issued. Never throws: a failure is logged and the next run retries.
 * ponytail: the due query scans the root bookings without an invoice; an index or a "checked" mark if that grows slow.
 */
export async function issueDueInvoices(exec: Exec, now: Date, opts: { bookingId?: string; timeUp?: () => boolean } = {}): Promise<number> {
  const timeUp = opts.timeUp ?? (() => false)
  let issued = 0
  try {
    const root = opts.bookingId ? sql`(SELECT coalesce(parent_booking_id, id) FROM bookings WHERE id = ${opts.bookingId})` : null
    const pending = await exec.select().from(invoices).where(and(isNull(invoices.fileKey), root ? sql`${invoices.rootBookingId} = ${root}` : undefined)).orderBy(asc(invoices.issuedAt)).limit(ISSUE_CAP)
    for (const inv of pending) {
      if (timeUp()) return issued
      await storePdf(inv)
    }
    const due = (await exec.execute<{ id: string }>(sql`SELECT r.id FROM bookings r WHERE ${isDue(now)} ${root ? sql`AND r.id = ${root}` : sql``} ORDER BY r.id LIMIT ${ISSUE_CAP}`)).rows
    for (const { id } of due) {
      if (timeUp()) break
      try {
        const inv = await issueOne(id, now)
        if (!inv) continue
        issued++
        await storePdf(inv)
      } catch (e) {
        console.error(`[invoices] booking ${id} not invoiced: ${describeError(e)}`)
      }
    }
  } catch (e) {
    console.error(`[invoices] sweep failed: ${describeError(e)}`)
  }
  return issued
}

/** After an ending's money step committed: the invoice of that booking's group, if it is now due. Never throws. */
export const issueInvoiceFor = (bookingId: string, now: Date): Promise<number> => issueDueInvoices(db, now, { bookingId })

const toInvoice = (r: typeof invoices.$inferSelect, userId: string): Invoice => {
  const draft = r.draft as InvoiceDraft
  const role = r.customerId === userId ? 'customer' : 'provider'
  return {
    id: r.id,
    number: r.number,
    kind: r.kind === 'invoice' ? 'invoice' : 'receipt',
    role,
    bookingId: r.rootBookingId,
    issuedAt: r.issuedAt.toISOString(),
    total: Number(r.total),
    currency: r.currency,
    counterparty: role === 'customer' ? draft.issuer.name : draft.recipient.name,
    pdfReady: r.fileKey !== null,
  }
}

/** The caller's invoices and receipts, as customer or as provider, newest first (RLS: the two parties only). */
export async function listInvoices(tx: Tx, userId: string): Promise<Invoice[]> {
  const own = await ownProvider(tx, userId)
  const rows = await tx
    .select()
    .from(invoices)
    .where(or(eq(invoices.customerId, userId), own ? eq(invoices.providerId, own.id) : undefined))
    .orderBy(desc(invoices.issuedAt), desc(invoices.number))
  return rows.map((r) => toInvoice(r, userId))
}

/** A signed download link for one of the caller's invoices (INVOICE_LINK_SECONDS); 404 for anyone but its two parties, 409 NOT_READY before its PDF is stored. */
export async function invoicePdfUrl(tx: Tx, userId: string, id: string): Promise<{ url: string }> {
  const [r] = isUuid(id) ? await tx.select().from(invoices).where(eq(invoices.id, id)) : []
  const own = r && r.customerId !== userId ? await ownProvider(tx, userId) : null
  if (!r || (r.customerId !== userId && own?.id !== r.providerId)) return fail(404, { error: 'Not found' })
  if (!r.fileKey) return fail(409, { error: 'NOT_READY' })
  return { url: await storage().getSignedUrl(documentsBucket(), r.fileKey, INVOICE_LINK_SECONDS) }
}
