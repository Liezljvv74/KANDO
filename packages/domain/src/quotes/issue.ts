import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { db, quoteDocuments, quotes, requests, users, type Tx } from '@kando/db'
import type { QuoteListItem } from '@kando/contract'
import { isUuid } from '../admin/common'
import { invoiceProvider } from '../invoices/issue'
import { formatQuoteNumber, isTestNumber, nextNumber, quoteSeries, yearOf } from '../invoices/numbering'
import { describeError } from '../log-error'
import { LIVE_PAYMENTS_ALLOWED } from '../payments/rules'
import type { Exec } from '../providers/eligibility'
import { fail } from '../providers/http'
import { ownProvider } from '../providers/profile'
import { documentsBucket, storage } from '../storage'
import { buildQuoteDraft, renderQuotePdf, type QuoteDraft } from './pdf'

/** A signed PDF link lives this long (the same as an invoice's). */
const LINK_SECONDS = 600
const CAP = 200

const nameOf = (first: string | null, last: string | null) => [first, last].filter((x) => x?.trim()).join(' ') || '-'
/** The number of the first quote of a request, without a revision suffix: a revision keeps it and adds `_Rev.N`. */
const baseOf = (n: string) => n.replace(/_Rev\.\d+$/, '')

/**
 * Gives a sent quote its document: the number and the snapshot, in one owner transaction (so the number series has no gap).
 * An ordinary request's quote only (an additional task's quote has no document). The first quote of a request takes the next number
 * of the provider's quote series; a revision (a later quote on the same request, `version - 1` revisions) keeps that number and
 * adds `_Rev.N`. Idempotent: a quote that has a document is left alone. Returns the document or null.
 */
async function issueOne(quoteId: string, now: Date, live: boolean): Promise<typeof quoteDocuments.$inferSelect | null> {
  return db.transaction(async (o) => {
    const [existing] = await o.select().from(quoteDocuments).where(eq(quoteDocuments.quoteId, quoteId))
    if (existing) return existing
    const [q] = await o.select().from(quotes).where(eq(quotes.id, quoteId))
    if (!q) return null
    const [r] = await o.select().from(requests).where(eq(requests.id, q.requestId)).for('update') // quotes of one request are numbered one at a time
    if (!r || r.parentBookingId) return null
    const p = await invoiceProvider(o, q.providerId)
    const [c] = await o.select({ f: users.firstName, l: users.lastName }).from(users).where(eq(users.id, r.customerId))
    if (!p || !c) return null
    const draft = buildQuoteDraft({
      provider: p.provider,
      country: p.country,
      customerName: nameOf(c.f, c.l),
      place: r.onSite === false ? null : [r.addressPostcode, r.addressCity].filter(Boolean).join(' ') || null, // never the street
      startAt: q.startAt,
      durationMin: q.durationMin,
      scope: q.scope,
      amount: Number(q.amount),
      currency: q.currency,
      validUntil: q.expiresAt,
      version: q.version,
    })
    const first = (await o.execute<{ number: string }>(sql`SELECT d.number FROM quote_documents d JOIN quotes x ON x.id = d.quote_id WHERE x.request_id = ${q.requestId} ORDER BY x.version LIMIT 1`)).rows[0]
    const rev = q.version - 1
    let base: string
    if (first) base = baseOf(first.number)
    else {
      const year = yearOf(now)
      base = formatQuoteNumber(q.providerId, year, await nextNumber(o, quoteSeries(q.providerId, year, !live)), !live)
    }
    const number = rev > 0 ? `${base}_Rev.${rev}` : base
    const [row] = await o.insert(quoteDocuments).values({ quoteId, providerId: q.providerId, customerId: r.customerId, number, issuedAt: now, draft }).onConflictDoNothing({ target: quoteDocuments.quoteId }).returning()
    return row ?? null
  })
}

/** Renders and stores the PDF (`quotes/<providerId>/<number>.pdf`) and records the key; a failure leaves `fileKey` null for the next sweep. Never throws. */
async function storePdf(doc: typeof quoteDocuments.$inferSelect): Promise<void> {
  try {
    const key = `quotes/${doc.providerId}/${doc.number}.pdf`
    const bytes = await renderQuotePdf(doc.draft as QuoteDraft, doc.number, doc.issuedAt, isTestNumber(doc.number))
    await storage().put(documentsBucket(), key, Buffer.from(bytes), 'application/pdf')
    await db.update(quoteDocuments).set({ fileKey: key }).where(and(eq(quoteDocuments.id, doc.id), isNull(quoteDocuments.fileKey)))
  } catch (e) {
    console.error(`[quotes] PDF of ${doc.number} not stored: ${describeError(e)}`)
  }
}

/**
 * After a quote was sent and committed: its numbered document and PDF. Earlier versions of the same request that have no document yet
 * (an issue that failed) get theirs first, in order, so a revision always continues the first quote's number. Never throws (the quote
 * stands without it; the sweep retries).
 */
export async function issueQuoteDocument(quoteId: string, now = new Date(), live = LIVE_PAYMENTS_ALLOWED): Promise<void> {
  try {
    const [q] = await db.select({ requestId: quotes.requestId, version: quotes.version }).from(quotes).where(eq(quotes.id, quoteId))
    if (!q) return
    const earlier = await db.execute<{ id: string }>(sql`SELECT x.id FROM quotes x WHERE x.request_id = ${q.requestId} AND x.version < ${q.version}
      AND NOT EXISTS (SELECT 1 FROM quote_documents d WHERE d.quote_id = x.id) ORDER BY x.version`)
    for (const id of [...earlier.rows.map((r) => r.id), quoteId]) {
      const doc = await issueOne(id, now, live)
      if (doc && !doc.fileKey) await storePdf(doc)
    }
  } catch (e) {
    console.error(`[quotes] document of quote ${quoteId} not issued: ${describeError(e)}`)
  }
}

/**
 * The sweep (cron): gives a recent quote that missed its document one (an issue that failed after the quote committed; quotes younger
 * than 5 minutes are left to their own after-commit step, quotes older than 30 days are not numbered now), then stores the PDFs a
 * storage failure left out. Idempotent; never throws.
 */
export async function storePendingQuoteDocuments(exec: Exec, timeUp: () => boolean = () => false): Promise<number> {
  let stored = 0
  try {
    const missing = await exec.execute<{ id: string }>(sql`SELECT q.id FROM quotes q JOIN requests r ON r.id = q.request_id
      WHERE r.parent_booking_id IS NULL AND q.created_at < now() - interval '5 minutes' AND q.created_at > now() - interval '30 days'
        AND NOT EXISTS (SELECT 1 FROM quote_documents d WHERE d.quote_id = q.id) ORDER BY q.request_id, q.version LIMIT ${CAP}`)
    for (const m of missing.rows) {
      if (timeUp()) return stored
      await issueQuoteDocument(m.id)
      stored++
    }
    const unstored = await exec.select().from(quoteDocuments).where(isNull(quoteDocuments.fileKey)).orderBy(asc(quoteDocuments.issuedAt)).limit(CAP)
    for (const d of unstored) {
      if (timeUp()) break
      await storePdf(d)
      stored++
    }
  } catch (e) {
    console.error(`[quotes] sweep failed: ${describeError(e)}`)
  }
  return stored
}

/**
 * The caller's quote documents, as the provider ("Quotes sent") and as the customer ("My received quotes"), newest first. A person who is
 * both gets both. Quotes sent before documents existed are not listed. RLS: the two parties only.
 */
export async function listQuoteDocuments(tx: Tx, userId: string): Promise<QuoteListItem[]> {
  const own = await ownProvider(tx, userId)
  const rows = await tx
    .select({ d: quoteDocuments, status: quotes.status, requestId: quotes.requestId, startAt: quotes.startAt, durationMin: quotes.durationMin, amount: quotes.amount, currency: quotes.currency })
    .from(quoteDocuments)
    .innerJoin(quotes, eq(quotes.id, quoteDocuments.quoteId))
    .where(sql`${quoteDocuments.customerId} = ${userId} ${own ? sql`OR ${quoteDocuments.providerId} = ${own.id}` : sql``}`)
    .orderBy(sql`${quoteDocuments.issuedAt} DESC`, sql`${quoteDocuments.number} DESC`)
  const out: QuoteListItem[] = []
  for (const r of rows) {
    const draft = r.d.draft as QuoteDraft
    // as the customer the quote is "received" (the issuer is the other side); as the provider it is "sent" (the customer is). Nobody is both sides of one quote.
    const role = r.d.customerId === userId ? 'customer' : 'provider'
    out.push({
      id: r.d.id,
      quoteId: r.d.quoteId,
      number: r.d.number,
      role,
      requestId: r.requestId,
      startAt: r.startAt ? r.startAt.toISOString() : null,
      durationMin: r.durationMin,
      amount: Number(r.amount),
      currency: r.currency as QuoteListItem['currency'],
      counterparty: role === 'customer' ? draft.issuer.name : draft.customerName,
      status: r.status as QuoteListItem['status'],
      issuedAt: r.d.issuedAt.toISOString(),
      pdfReady: r.d.fileKey !== null,
    })
  }
  return out
}

/** A signed download link for one quote document (the document id from the list); 404 for anyone but its two parties, 409 NOT_READY before its PDF is stored. */
export async function quotePdfUrl(tx: Tx, userId: string, id: string): Promise<{ url: string }> {
  const [d] = isUuid(id) ? await tx.select().from(quoteDocuments).where(eq(quoteDocuments.id, id)) : []
  const own = d && d.customerId !== userId ? await ownProvider(tx, userId) : null
  if (!d || (d.customerId !== userId && own?.id !== d.providerId)) return fail(404, { error: 'Not found' })
  if (!d.fileKey) return fail(409, { error: 'NOT_READY' })
  return { url: await storage().getSignedUrl(documentsBucket(), d.fileKey, LINK_SECONDS) }
}
