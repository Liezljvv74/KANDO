import { sql } from 'drizzle-orm'
import { TIME_ZONE } from '@kando/i18n'
import type { Exec } from '../providers/eligibility'

/**
 * The next number of a series. Call it in the same transaction as the invoice insert: the counter row stays locked until
 * that commits (so numbers of one series are handed out one at a time), and a rollback takes the bump back with it, so the
 * series never has a gap.
 */
export async function nextNumber(exec: Exec, series: string): Promise<number> {
  const r = await exec.execute<{ last: number }>(sql`
    INSERT INTO invoice_counters (series, last) VALUES (${series}, 1)
    ON CONFLICT (series) DO UPDATE SET last = invoice_counters.last + 1 RETURNING last`)
  return Number(r.rows[0]!.last)
}

/** The calendar year of an instant in TIME_ZONE (an invoice at 00:30 on 1 January in Berlin belongs to the new year). */
export const yearOf = (d: Date): number => Number(new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric' }).format(d))

/** A provider's counter for a year: keyed by the FULL provider id, so two providers never share one (gapless per issuer). */
export const providerSeries = (providerId: string, year: number): string => `${providerId}-${year}`

/** The printed number `<first 8 characters of the provider id, upper case>-<year>-0001` (unique per provider, not globally). */
export const formatNumber = (providerId: string, year: number, n: number): string => `${providerId.slice(0, 8).toUpperCase()}-${year}-${String(n).padStart(4, '0')}`
