import { sql, type AnyColumn, type SQL } from 'drizzle-orm'
import { LIST_PAGE } from '@kando/contract'

/** A time as cursor text with microseconds: a JS Date would cut them, and a cursor on it would repeat a row. */
export const stampOf = (t: AnyColumn | SQL) => sql<string>`to_char(${t} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`

/** In a newest-first list ordered by (key, id): the rows after the cursor (the route checked its form). */
export const olderThan = (key: AnyColumn | SQL, id: AnyColumn, cursor?: string) => {
  if (!cursor) return undefined
  const [ts, last] = cursor.split('|')
  return sql`(${key}, ${id}) < (${ts}::timestamptz, ${last}::uuid)`
}

/** Rows read with `.limit(LIST_PAGE + 1)`: the page, and the cursor of its last row when one more exists. */
export function pageOf<R extends { ts: string; id: string }>(rows: R[]): { rows: R[]; next: string | null } {
  const page = rows.slice(0, LIST_PAGE)
  const last = page.at(-1)
  return { rows: page, next: rows.length > LIST_PAGE && last ? `${last.ts}|${last.id}` : null }
}
