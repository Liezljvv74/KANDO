import { z } from 'zod'

export const LangSchema = z.enum(['de', 'en'])
export const CurrencySchema = z.literal('EUR')
export const PriceTypeSchema = z.enum(['fixed', 'hourly', 'from', 'on-request'])

/** A money amount: 0 or more, at most two decimals. */
export const AmountSchema = z
  .number()
  .min(0)
  .max(999_999_999)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'At most 2 decimals')

export const text = (max: number) => z.string().max(max)
export const requiredText = (max: number) => z.string().trim().min(1).max(max)

/** The envelope the app reads lists from: `{ docs: [...] }`. */
export const docsOf = <S extends z.ZodType>(schema: S) => z.object({ docs: z.array(schema) })

/** Rows per page of the app's lists (bookings, requests, threads). */
export const LIST_PAGE = 50

/**
 * An opaque list cursor `<ISO time with up to microseconds>|<uuid>`. Checked strictly (a real date, a real uuid), so a forged
 * cursor is a 400 and never reaches the database cast.
 */
export const CursorSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  .refine((c) => {
    const d = new Date(c.split('|')[0]!)
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === c.slice(0, 10) // 2026-02-30 rolls over: refused
  }, 'Invalid time')

/** GET /bookings and /requests: `?role=&cursor=`. */
export const ListQuerySchema = z.object({ role: z.enum(['customer', 'provider']).default('customer'), cursor: CursorSchema.optional() })
export type ListQuery = z.infer<typeof ListQuerySchema>

/** A page of a list; `next` is the cursor of the following page, null on the last. */
export type Page<T> = { docs: T[]; next: string | null }
