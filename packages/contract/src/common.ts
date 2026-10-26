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
