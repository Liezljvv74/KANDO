import { ApiError } from '@/api/client'
import { errorText } from '@/i18n'

let off = false
/** True once the server answered PAYMENTS_OFF in this session: the pay and payout buttons then stay hidden. */
export const paymentsOff = () => off
export const resetPaymentsOff = () => {
  off = false
}

/** Remembers PAYMENTS_OFF from an error code; true when payments are off (a Retry could never succeed, so the card shows nothing). */
export function noteIfOff(code: string | null | undefined): boolean {
  if (code === 'PAYMENTS_OFF') off = true
  return off
}

/** The message for a failed payments call; remembers PAYMENTS_OFF. */
export function paymentsProblem(e: unknown): string {
  const code = e instanceof ApiError ? e.code : ''
  noteIfOff(code)
  return errorText(code)
}
