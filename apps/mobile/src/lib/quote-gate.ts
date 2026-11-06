import type { MyProfile } from '@kando/contract'

import type { Key } from '@/i18n'

type Step = NonNullable<MyProfile['quoteSteps']>[number]

const ROWS: Record<Step, { title: Key; hint?: Key }> = {
  payout: { title: 'quoteGate.payout', hint: 'quoteGate.payoutHint' },
  consent: { title: 'quoteGate.consent', hint: 'quoteGate.consentHint' },
  taxId: { title: 'quoteGate.taxId' },
}

/** The gate shows while a step is missing (an old server without `quoteSteps` never greys the button; the server still refuses). */
export const quoteBlocked = (steps: MyProfile['quoteSteps']): boolean => (steps?.length ?? 0) > 0

export const gateHeading = (n: number): Key => (n === 1 ? 'quoteGate.headingOne' : 'quoteGate.headingMany')

export const gateRows = (steps: Step[]) => steps.map((step) => ({ step, ...ROWS[step] }))
