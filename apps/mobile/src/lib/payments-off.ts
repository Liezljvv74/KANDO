import { ApiError } from '@/api/client'
import { errorText } from '@/i18n'

let off = false
/** True once the server answered PAYMENTS_OFF in this session: the pay and payout buttons then stay hidden. */
export const paymentsOff = () => off
export const resetPaymentsOff = () => {
  off = false
}

/** The message for a failed payments call; remembers PAYMENTS_OFF. */
export function paymentsProblem(e: unknown): string {
  const code = e instanceof ApiError ? e.code : ''
  if (code === 'PAYMENTS_OFF') off = true
  return errorText(code)
}
