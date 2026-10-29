export type PayoutState = 'notStarted' | 'waiting' | 'ready'

/** The server only says ready or not; "waiting" is when this person has opened the Stripe page (in this session) without finishing. */
export const payoutState = (ready: boolean | undefined, opened: boolean): PayoutState => (ready ? 'ready' : opened ? 'waiting' : 'notStarted')
