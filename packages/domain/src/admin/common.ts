import { asc, desc, type AnyColumn, type SQL } from 'drizzle-orm'
import type { AdminListQuery } from '@kando/contract'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (s: string) => UUID.test(s)

/** The filter object of a list query (`{ "q": "...", "status": "..." }`); anything else is empty. */
export function filterOf(q: AdminListQuery): Record<string, unknown> {
  let f: unknown = {}
  try { f = q.filter ? JSON.parse(q.filter) : {} } catch { /* a malformed filter counts as none */ }
  return f && typeof f === 'object' && !Array.isArray(f) ? (f as Record<string, unknown>) : {}
}
export const textOf = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
export const like = (q: string) => `%${q.replace(/[\\%_]/g, '\\$&')}%`
export const pageOf = (q: AdminListQuery) => ({ limit: q.pageSize, offset: (q.page - 1) * q.pageSize })

/** `sort` is "field:asc" or "field:desc"; only fields in `cols` count, otherwise `fallback`. */
export function orderOf(sort: string | undefined, cols: Record<string, AnyColumn | SQL>, fallback: SQL[]): SQL[] {
  const [field, dir] = (sort ?? '').split(':')
  const col = field && Object.hasOwn(cols, field) ? cols[field] : undefined
  return col ? [dir === 'desc' ? desc(col) : asc(col)] : fallback
}

export const ok = (data: unknown, total?: number, status = 200) =>
  Response.json(total === undefined ? { data } : { data, total }, { status })
export const notFound = () => Response.json({ error: 'Not found' }, { status: 404 })
export const uniqueViolation = (e: unknown) => (e as { cause?: { code?: string } }).cause?.code === '23505'
