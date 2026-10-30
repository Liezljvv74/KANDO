import { sql } from 'drizzle-orm'
import { ledgerEntries } from '@kando/db'
import type { Exec } from '../providers/eligibility'

export type LedgerKind = 'charge' | 'refund' | 'transfer' | 'commission'

/**
 * Appends one money row (owner connection: the table is staff only). A row with the same idempotency key already there
 * wins and nothing is written: DO NOTHING, never DO UPDATE (the append-only trigger refuses every update).
 */
export async function addLedger(exec: Exec, row: { bookingId: string; providerId: string; kind: LedgerKind; amount: number; currency: string; gatewayRef: string; idempotencyKey: string }): Promise<void> {
  await exec
    .insert(ledgerEntries)
    .values({ ...row, amount: row.amount.toFixed(2) })
    .onConflictDoNothing({ target: ledgerEntries.idempotencyKey })
}

/** What the customer has paid for the booking and not had back: charges minus refunds (exact numeric sum). */
export async function paidAmount(exec: Exec, bookingId: string): Promise<number> {
  const r = await exec.execute<{ paid: string }>(
    sql`SELECT coalesce(sum(CASE kind WHEN 'charge' THEN amount WHEN 'refund' THEN -amount ELSE 0 END), 0)::text AS paid FROM ledger_entries WHERE booking_id = ${bookingId}`,
  )
  return Number(r.rows[0]!.paid)
}
