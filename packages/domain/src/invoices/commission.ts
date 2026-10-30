import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import { commissionInvoices, db, providers, type Tx } from '@kando/db'
import type { CommissionInvoice } from '@kando/contract'
import { formatMoney, TIME_ZONE } from '@kando/i18n'
import { isUuid } from '../admin/common'
import { notifyBookingEvent } from '../bookings/notify'
import { describeError } from '../log-error'
import { LIVE_PAYMENTS_ALLOWED } from '../payments/rules'
import type { Exec } from '../providers/eligibility'
import { fail } from '../providers/http'
import { ownProvider } from '../providers/profile'
import { documentsBucket, storage } from '../storage'
import { providerParty, type Party } from './build'
import { PLATFORM_ENTITY, platformDocumentsBlocked } from './entity'
import { INVOICE_LINK_SECONDS, invoiceProvider } from './issue'
import { isTestNumber, nextNumber, TEST_NUMBER_PREFIX, yearOf } from './numbering'
import { renderLinesPdf } from './pdf'

// All wording here must be checked by a tax adviser before launch (README launch item), like the provider invoices.

/** One booking's commission: the sum of its `commission` ledger rows in the month (settle writes one per booking). */
export type CommissionLine = { bookingId: string; description: string; date: string; amount: number }
/**
 * The issued commission invoice as stored (the snapshot the PDF is drawn from). Amounts are what the ledger recorded as
 * commission, i.e. the part of the customer's payment KANDO kept, taken as gross: no VAT is split out; the VAT wording is
 * PLATFORM_ENTITY.vatNote until the legal entity and its tax status exist (tax adviser).
 */
export type CommissionDraft = { month: string; issuer: Party; recipient: Party; lines: CommissionLine[]; total: number; currency: string; notes: string[] }

/** At most this many invoices per run (on top of the time budget). */
const COMMISSION_CAP = 200
/**
 * A month is invoiced this long after it ended: a commission row is stamped at its settle transaction's start, which may
 * commit seconds later (gateway calls), so a row stamped 23:59:59 on the last day is in the ledger before its month is issued.
 */
export const COMMISSION_GRACE_MINUTES = 60
export const COMMISSION_LIST_URL = 'skilled://invoices/commission'
const LOST = Symbol('lost') // another run issued this invoice first

const ym = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit' })
const day = (d: Date) => d.toLocaleDateString('de-DE', { timeZone: TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric' })

/** The calendar month of an instant in TIME_ZONE, as YYYY-MM. */
export const monthOf = (d: Date): string => ym.format(d)

/** `l.created_at` falls in the month in TIME_ZONE (midnight to midnight local time, so DST shifts are right). */
const inMonth = (month: string) => {
  const first = `${month}-01`
  return sql`l.created_at >= ${first}::timestamp AT TIME ZONE ${TIME_ZONE} AND l.created_at < (${first}::timestamp + interval '1 month') AT TIME ZONE ${TIME_ZONE}`
}

/**
 * Every (provider, month) with commission and no commission invoice, oldest month first: months before `before` (YYYY-MM;
 * a missed month is caught up), or every month of one person's provider (`userId`, account deletion: the current one too).
 * Only providers that still exist (the recipient's details are needed).
 * ponytail: scans every commission row each run (no index on created_at); keep a "last month done" mark if that grows slow.
 */
async function dueMonths(exec: Exec, o: { before?: string; userId?: string; limit?: number }): Promise<{ provider_id: string; month: string }[]> {
  const r = await exec.execute<{ provider_id: string; month: string }>(sql`SELECT m.provider_id, m.month FROM (
      SELECT l.provider_id, to_char(l.created_at AT TIME ZONE ${TIME_ZONE}, 'YYYY-MM') AS month FROM ledger_entries l
      WHERE l.kind = 'commission'
        AND EXISTS (SELECT 1 FROM providers p WHERE p.id = l.provider_id ${o.userId ? sql`AND p.owner_id = ${o.userId}` : sql``})
        ${o.before ? sql`AND l.created_at < ${`${o.before}-01`}::timestamp AT TIME ZONE ${TIME_ZONE}` : sql``}
      GROUP BY 1, 2 HAVING sum(l.amount) > 0) m
    WHERE NOT EXISTS (SELECT 1 FROM commission_invoices c WHERE c.provider_id = m.provider_id AND c.month = m.month)
    ORDER BY m.month, m.provider_id LIMIT ${o.limit ?? COMMISSION_CAP}`)
  return r.rows
}

/** The person's provider has commission in some month (the current one included) without its commission invoice. */
export const hasUninvoicedCommission = async (exec: Exec, userId: string): Promise<boolean> => (await dueMonths(exec, { userId, limit: 1 })).length > 0

/**
 * Issues one provider's commission invoice for the month, or null (provider gone, nothing to invoice, or another run won).
 * One owner transaction: the number comes from the platform series `commission:<year>` (the counter row lock serialises
 * every commission invoice); the insert does nothing on (provider_id, month), and then the transaction rolls back with
 * the counter bump: one invoice, no gap.
 */
async function issueOne(providerId: string, month: string, clock: () => Date, live: boolean): Promise<typeof commissionInvoices.$inferSelect | null> {
  try {
    return await db.transaction(async (o) => {
      const p = await invoiceProvider(o, providerId)
      if (!p) return null
      const rows = (
        await o.execute<{ booking_id: string; amount: string; at: Date | string; currency: string; currencies: number; title: string | null }>(sql`
        SELECT l.booking_id, sum(l.amount)::text AS amount, max(l.created_at) AS at, min(l.currency) AS currency, count(DISTINCT l.currency)::int AS currencies,
          (SELECT coalesce(q.scope, s.title, rq.description) FROM bookings b LEFT JOIN quotes q ON q.id = b.quote_id LEFT JOIN services s ON s.id = b.service_id
            LEFT JOIN requests rq ON rq.id = b.request_id WHERE b.id = l.booking_id) AS title
        FROM ledger_entries l WHERE l.provider_id = ${providerId} AND l.kind = 'commission' AND ${inMonth(month)}
        GROUP BY l.booking_id HAVING sum(l.amount) > 0 ORDER BY max(l.created_at), l.booking_id`)
      ).rows
      if (!rows.length) return null
      const currency = rows[0]!.currency
      // ponytail: one currency per provider today; a second market needs one invoice per currency
      if (rows.some((r) => r.currencies !== 1 || r.currency !== currency)) throw new Error(`commission of provider ${providerId} in ${month} has several currencies`)
      const lines = rows.map((r) => ({ bookingId: r.booking_id, description: r.title ?? '', date: new Date(r.at).toISOString(), amount: Number(r.amount) }))
      const total = Math.round(rows.reduce((s, r) => s + Math.round(Number(r.amount) * 100), 0)) / 100
      const draft: CommissionDraft = {
        month,
        issuer: { name: PLATFORM_ENTITY.name, address: `${PLATFORM_ENTITY.address}\n${PLATFORM_ENTITY.register}`, taxId: PLATFORM_ENTITY.vatId },
        recipient: providerParty(p.provider),
        lines,
        total,
        currency,
        notes: [PLATFORM_ENTITY.vatNote],
      }
      // as issue.ts: the date of issue is read once the counter lock is held, so numbers and dates stay in the same order
      const before = clock()
      const year = yearOf(before)
      const n = await nextNumber(o, `commission:${year}${live ? '' : ':test'}`) // test documents count in their own series
      const after = clock()
      const issuedAt = yearOf(after) === year ? after : before
      const [row] = await o
        .insert(commissionInvoices)
        .values({ providerId, month, number: `${live ? '' : TEST_NUMBER_PREFIX}K-${year}-${String(n).padStart(5, '0')}`, total: total.toFixed(2), currency, issuedAt, draft })
        .onConflictDoNothing({ target: [commissionInvoices.providerId, commissionInvoices.month] })
        .returning()
      if (!row) throw LOST // rolls the counter back: no gap
      return row
    })
  } catch (e) {
    if (e === LOST) return null
    throw e
  }
}

/** The text lines of the commission invoice PDF: German labels with English in brackets, as the provider invoices. */
export function commissionLines(d: CommissionDraft): string[] {
  const m = (x: number) => formatMoney(x, d.currency, 'de')
  const [y, mo] = d.month.split('-')
  return [
    'Provisionsrechnung (Commission invoice)',
    'Von (From):',
    d.issuer.name,
    ...(d.issuer.address ? [d.issuer.address] : []),
    ...(d.issuer.taxId ? [`USt-IdNr. (VAT ID): ${d.issuer.taxId}`] : []),
    'An (To):',
    ...(d.recipient.address?.startsWith(d.recipient.name) ? [] : [d.recipient.name]),
    ...(d.recipient.address ? [d.recipient.address] : []),
    ...(d.recipient.taxId ? [`Steuernummer / USt-IdNr. (Tax number / VAT ID): ${d.recipient.taxId}`] : []),
    `Leistungszeitraum (Service period): ${mo}/${y}`,
    ...d.lines.flatMap((l) => [`Provision (Commission), Buchung (Booking) ${l.bookingId.slice(0, 8).toUpperCase()}, ${day(new Date(l.date))}: ${l.description}`, `  Betrag (Amount): ${m(l.amount)}`]),
    `Summe (Total): ${m(d.total)}`,
    ...d.notes,
  ]
}

/**
 * Renders and stores the PDF (`commission-invoices/<providerId>/<number>.pdf` in the documents bucket) and records the
 * key; the run that records it tells the provider (`commission-invoice-ready`) once the download works. A storage failure
 * leaves `fileKey` null for the next run. Never throws.
 */
async function storePdf(inv: typeof commissionInvoices.$inferSelect): Promise<void> {
  try {
    const key = `commission-invoices/${inv.providerId}/${inv.number}.pdf`
    const bytes = await renderLinesPdf(commissionLines(inv.draft as CommissionDraft), inv.number, inv.issuedAt, isTestNumber(inv.number))
    await storage().put(documentsBucket(), key, Buffer.from(bytes), 'application/pdf')
    const [done] = await db.update(commissionInvoices).set({ fileKey: key }).where(and(eq(commissionInvoices.id, inv.id), isNull(commissionInvoices.fileKey))).returning({ id: commissionInvoices.id })
    if (!done) return
    const owner = (await db.select({ id: providers.ownerId }).from(providers).where(eq(providers.id, inv.providerId)))[0]?.id
    // the push opens the app's commission invoice list (apps/mobile/src/app/invoices/commission.tsx)
    if (owner) await notifyBookingEvent('commission-invoice-ready', owner, { url: COMMISSION_LIST_URL })
  } catch (e) {
    console.error(`[commission] PDF of ${inv.number} not stored: ${describeError(e)}`)
  }
}

/**
 * The monthly commission run (owner connection, each invoice its own transaction): first the PDFs a storage failure left
 * out, then one invoice per provider and month with commission and none for it yet, for every month that ended at least
 * COMMISSION_GRACE_MINUTES before `now` in TIME_ZONE (oldest first, so a missed month is caught up), until `timeUp` or
 * COMMISSION_CAP. Idempotent (unique provider and month). `userId` (account deletion): that person's provider only, every
 * month including the current, partial one, as the recipient's details are about to go. Returns how many it issued. Never
 * throws: a failure is logged and the next run retries.
 */
export async function issueCommissionInvoices(exec: Exec, now: Date, opts: { timeUp?: () => boolean; clock?: () => Date; userId?: string; live?: boolean } = {}): Promise<number> {
  const timeUp = opts.timeUp ?? (() => false)
  const live = opts.live ?? LIVE_PAYMENTS_ALLOWED
  let issued = 0
  // live payments with the legal entity still "[LEGAL NAME]": nothing is issued, no number used; the next run retries
  if (platformDocumentsBlocked(live)) {
    console.error('[commission] not issued: payments are live but PLATFORM_ENTITY still has placeholders (fill in invoices/entity.ts); the next run retries')
    return 0
  }
  try {
    const pending = await exec.select().from(commissionInvoices).where(and(isNull(commissionInvoices.fileKey), opts.userId ? sql`${commissionInvoices.providerId} IN (SELECT id FROM providers WHERE owner_id = ${opts.userId})` : undefined)).orderBy(asc(commissionInvoices.issuedAt)).limit(COMMISSION_CAP)
    for (const inv of pending) {
      if (timeUp()) return issued
      await storePdf(inv)
    }
    if (timeUp()) return issued
    const due = await dueMonths(exec, opts.userId ? { userId: opts.userId } : { before: monthOf(new Date(now.getTime() - COMMISSION_GRACE_MINUTES * 60_000)) })
    for (const { provider_id: id, month } of due) {
      if (timeUp()) break
      try {
        const inv = await issueOne(id, month, opts.clock ?? (() => new Date()), live)
        if (!inv) continue
        issued++
        await storePdf(inv)
      } catch (e) {
        console.error(`[commission] provider ${id} not invoiced for ${month}: ${describeError(e)}`)
      }
    }
  } catch (e) {
    console.error(`[commission] run failed: ${describeError(e)}`)
  }
  return issued
}

const toDto = (r: typeof commissionInvoices.$inferSelect): CommissionInvoice => ({
  id: r.id,
  number: r.number,
  month: r.month,
  issuedAt: r.issuedAt.toISOString(),
  total: Number(r.total),
  currency: r.currency,
  pdfReady: r.fileKey !== null,
})

/** The caller's commission invoices (as a provider's owner), newest first. */
export async function listCommissionInvoices(tx: Tx, userId: string): Promise<CommissionInvoice[]> {
  const own = await ownProvider(tx, userId)
  if (!own) return []
  const rows = await tx.select().from(commissionInvoices).where(eq(commissionInvoices.providerId, own.id)).orderBy(desc(commissionInvoices.month))
  return rows.map(toDto)
}

/** A signed download link (INVOICE_LINK_SECONDS) for the provider's owner; 404 for anyone else, 409 NOT_READY before the PDF is stored. */
export async function commissionInvoicePdfUrl(tx: Tx, userId: string, id: string): Promise<{ url: string }> {
  const [r] = isUuid(id) ? await tx.select().from(commissionInvoices).where(eq(commissionInvoices.id, id)) : []
  const own = r ? await ownProvider(tx, userId) : null
  if (!r || own?.id !== r.providerId) return fail(404, { error: 'Not found' })
  if (!r.fileKey) return fail(409, { error: 'NOT_READY' })
  return { url: await storage().getSignedUrl(documentsBucket(), r.fileKey, INVOICE_LINK_SECONDS) }
}
